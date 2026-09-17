import Foundation
import AVFoundation
import CoreMedia
import CoreVideo
import CoreGraphics
import Vision

/// Aggregated, device-local face features over the trailing window.
struct FaceFeatures {
    /// Fraction of recent processed frames with a face.
    let presentFraction: Double
    /// Blinks per minute (nil until >= 10 s of face observation).
    let blinkRatePerMin: Double?
    /// Fraction of recent frames looking at the screen (|yaw|,|pitch| small).
    let gazeOnScreen: Double
    /// 0..1 mouth-geometry smile heuristic (nil when lips not found).
    let smile: Double?
    /// Mean per-frame face-centre displacement (normalized image units).
    let headMotion: Double
    /// 0..1 detection / capture quality.
    let quality: Double
    let frames: Int
}

/// Host-clock seconds; same time base as AVCapture sample-buffer PTS.
func vsHostTimeSeconds() -> Double {
    return CMTimeGetSeconds(CMClockGetTime(CMClockGetHostTimeClock()))
}

/// Front-camera face sensing with Vision (NOT ARKit / TrueDepth).
/// 640x480 at ~10 fps (5 fps on low battery). Frames are processed in memory and
/// never stored; only scalar features and a skin green-mean (for rPPG) leave here.
final class FaceCapture: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate {
    /// (hostTimeSec, skin green mean or nil when no usable face, face quality 0..1)
    var onSkinSample: ((Double, Double?, Double) -> Void)?

    private struct FrameSummary {
        let t: Double
        let present: Bool
        let onScreen: Bool
        let smile: Double?
        let quality: Double
        let centerDelta: Double
    }

    private let sessionQueue = DispatchQueue(label: "com.thevoid.sensing.face.session")
    private let frameQueue = DispatchQueue(label: "com.thevoid.sensing.face.frames")

    // sessionQueue state
    private var session: AVCaptureSession?

    // lock-guarded
    private let lock = NSLock()
    private var running = false
    private var lowPower = false
    private var frames: [FrameSummary] = []
    private var blinkTimes: [Double] = []
    private var faceSeenSince: Double? = nil

    // frameQueue state
    private var lastProcessedT = -1.0
    private var earOpenEMA: Double? = nil
    private var eyeClosed = false
    private var closedSince = 0.0
    private var processedCount = 0
    private var cachedCaptureQuality: Double? = nil
    private var prevCenter: CGPoint? = nil

    var isRunning: Bool {
        lock.lock()
        defer { lock.unlock() }
        return running
    }

    func setLowPower(_ on: Bool) {
        lock.lock()
        lowPower = on
        lock.unlock()
    }

    func start() {
        lock.lock()
        running = true
        lock.unlock()
        sessionQueue.async { [weak self] in self?.startSession() }
    }

    func stop() {
        lock.lock()
        running = false
        frames.removeAll()
        blinkTimes.removeAll()
        faceSeenSince = nil
        lock.unlock()
        frameQueue.async { [weak self] in
            guard let self = self else { return }
            self.lastProcessedT = -1
            self.earOpenEMA = nil
            self.eyeClosed = false
            self.cachedCaptureQuality = nil
            self.prevCenter = nil
        }
        sessionQueue.async { [weak self] in self?.stopSession() }
    }

    // MARK: - Session (sessionQueue)

    private func startSession() {
        guard isRunning, session == nil,
              AVCaptureDevice.authorizationStatus(for: .video) == .authorized,
              let dev = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .front),
              let input = try? AVCaptureDeviceInput(device: dev) else { return }
        let s = AVCaptureSession()
        s.beginConfiguration()
        if s.canSetSessionPreset(.vga640x480) {
            s.sessionPreset = .vga640x480
        } else if s.canSetSessionPreset(.medium) {
            s.sessionPreset = .medium
        }
        guard s.canAddInput(input) else { s.commitConfiguration(); return }
        s.addInput(input)
        let output = AVCaptureVideoDataOutput()
        output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: NSNumber(value: kCVPixelFormatType_32BGRA)]
        output.alwaysDiscardsLateVideoFrames = true
        output.setSampleBufferDelegate(self, queue: frameQueue)
        guard s.canAddOutput(output) else { s.commitConfiguration(); return }
        s.addOutput(output)
        if let conn = output.connection(with: .video), conn.isVideoOrientationSupported {
            // Portrait buffers so Vision can use `.up` and ROIs map directly.
            conn.videoOrientation = .portrait
        }
        s.commitConfiguration()
        PPGCameraSource.setFrameRate(dev, fps: 15)
        session = s
        s.startRunning()
        // A stop() may have raced in while we were configuring.
        if !isRunning { stopSession() }
    }

    private func stopSession() {
        if let s = session {
            if s.isRunning { s.stopRunning() }
            for o in s.outputs { s.removeOutput(o) }
            for i in s.inputs { s.removeInput(i) }
        }
        session = nil
    }

    // MARK: - Frames (frameQueue)

    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        lock.lock()
        let isOn = running
        let lp = lowPower
        lock.unlock()
        guard isOn else { return }
        let t = CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(sampleBuffer))
        guard t.isFinite else { return }
        let interval = lp ? 0.2 : 0.1
        if lastProcessedT >= 0 && t - lastProcessedT < interval * 0.9 { return }
        lastProcessedT = t
        guard let pb = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        process(pb, t: t)
    }

    private func process(_ pb: CVPixelBuffer, t: Double) {
        let width = CVPixelBufferGetWidth(pb)
        let height = CVPixelBufferGetHeight(pb)
        guard width > 0, height > 0 else { return }
        let size = CGSize(width: width, height: height)
        processedCount += 1

        let handler = VNImageRequestHandler(cvPixelBuffer: pb, orientation: .up, options: [:])
        let rectReq = VNDetectFaceRectanglesRequest()
        rectReq.revision = VNDetectFaceRectanglesRequestRevision3
        do {
            try handler.perform([rectReq])
        } catch {
            recordAbsent(t)
            return
        }
        let faces: [VNFaceObservation] = rectReq.results ?? []
        guard let face = faces.max(by: { a, b in
            a.boundingBox.width * a.boundingBox.height < b.boundingBox.width * b.boundingBox.height
        }) else {
            recordAbsent(t)
            return
        }

        let lmReq = VNDetectFaceLandmarksRequest()
        lmReq.inputFaceObservations = [face]
        var requests: [VNRequest] = [lmReq]
        var qReq: VNDetectFaceCaptureQualityRequest? = nil
        if processedCount % 5 == 1 || cachedCaptureQuality == nil {
            let q = VNDetectFaceCaptureQualityRequest()
            q.inputFaceObservations = [face]
            requests.append(q)
            qReq = q
        }
        try? handler.perform(requests)

        if let q = qReq, let obs = q.results?.first,
           let fq = FaceCapture.toDouble(obs.faceCaptureQuality) {
            cachedCaptureQuality = fq
        }
        let lmFace: VNFaceObservation? = lmReq.results?.first
        let bb = face.boundingBox

        // Head pose -> looking at the screen.
        let yaw = FaceCapture.toDouble(face.yaw)
        let pitch = FaceCapture.toDouble(face.pitch)
        let onScreen = abs(yaw ?? 0) < 0.35 && abs(pitch ?? 0) < 0.35

        // Quality: detector confidence + capture quality + face size.
        let areaQ = vsClamp(Double(bb.width * bb.height) / 0.06, 0, 1)
        let capQ = vsClamp((cachedCaptureQuality ?? 0.4) / 0.5, 0, 1)
        let quality = vsClamp(0.4 * Double(face.confidence) + 0.35 * capQ + 0.25 * areaQ, 0, 1)

        // Head motion (normalized centre displacement between processed frames).
        let center = CGPoint(x: bb.midX, y: bb.midY)
        var centerDelta = 0.0
        if let p = prevCenter {
            let dx = Double(center.x - p.x)
            let dy = Double(center.y - p.y)
            centerDelta = (dx * dx + dy * dy).squareRoot()
        }
        prevCenter = center

        var smile: Double? = nil
        if let lm = lmFace?.landmarks {
            // Blinks from eye aspect ratio.
            let earL = FaceCapture.aspectRatio(lm.leftEye, size: size)
            let earR = FaceCapture.aspectRatio(lm.rightEye, size: size)
            let ears = [earL, earR].compactMap { $0 }
            if !ears.isEmpty {
                updateBlink(ear: ears.reduce(0, +) / Double(ears.count), t: t)
            }
            // Smile from outer-lip width relative to face width.
            if let lips = lm.outerLips, lips.pointCount >= 4 {
                let pts = lips.pointsInImage(imageSize: size)
                let xs = pts.map { Double($0.x) }
                let ys = pts.map { Double($0.y) }
                if let minX = xs.min(), let maxX = xs.max(), let minY = ys.min(), let maxY = ys.max() {
                    let faceW = Double(bb.width) * Double(width)
                    if faceW > 1 {
                        let widthRatio = (maxX - minX) / faceW
                        let openness = (maxY - minY) / Swift.max(1.0, maxX - minX)
                        smile = vsClamp((widthRatio - 0.36) / 0.14, 0, 1) * (1.0 - 0.3 * vsClamp(openness - 0.5, 0, 1))
                    }
                }
            }
        }

        // rPPG skin sample (forehead + both cheeks).
        let green = FaceCapture.skinGreenMean(pb, box: bb)
        onSkinSample?(t, green, quality)

        lock.lock()
        if faceSeenSince == nil { faceSeenSince = t }
        frames.append(FrameSummary(t: t, present: true, onScreen: onScreen, smile: smile,
                                   quality: quality, centerDelta: centerDelta))
        trimLocked(now: t)
        lock.unlock()
    }

    private func recordAbsent(_ t: Double) {
        prevCenter = nil
        onSkinSample?(t, nil, 0)
        lock.lock()
        frames.append(FrameSummary(t: t, present: false, onScreen: false, smile: nil, quality: 0, centerDelta: 0))
        trimLocked(now: t)
        lock.unlock()
    }

    private func trimLocked(now: Double) {
        if let idx = frames.firstIndex(where: { $0.t >= now - 12.0 }), idx > 0 {
            frames.removeFirst(idx)
        }
        if let idx = blinkTimes.firstIndex(where: { $0 >= now - 60.0 }) {
            if idx > 0 { blinkTimes.removeFirst(idx) }
        } else {
            blinkTimes.removeAll()
        }
    }

    private func updateBlink(ear: Double, t: Double) {
        guard ear.isFinite, ear > 0 else { return }
        guard let open = earOpenEMA else {
            earOpenEMA = ear
            return
        }
        let closedNow = ear < 0.65 * open
        if closedNow && !eyeClosed {
            eyeClosed = true
            closedSince = t
        } else if !closedNow && eyeClosed {
            eyeClosed = false
            let dur = t - closedSince
            if dur <= 0.6 {
                lock.lock()
                blinkTimes.append(t)
                lock.unlock()
            }
        }
        if !closedNow {
            earOpenEMA = open * 0.95 + ear * 0.05
        } else if t - closedSince > 2.0 {
            // Long "closure" is more likely a baseline shift (pose / lighting): re-anchor.
            earOpenEMA = ear
            eyeClosed = false
        }
    }

    /// Features over the trailing 10 s, or nil when nothing fresh.
    func features() -> FaceFeatures? {
        let now = vsHostTimeSeconds()
        lock.lock()
        defer { lock.unlock() }
        guard let newest = frames.last, now - newest.t < 2.0 else { return nil }
        let recent = frames.filter { $0.t >= now - 10.0 }
        guard !recent.isEmpty else { return nil }
        let present = recent.filter { $0.present }
        let presentFraction = Double(present.count) / Double(recent.count)
        let gaze = Double(recent.filter { $0.onScreen }.count) / Double(recent.count)
        let smiles = present.compactMap { $0.smile }
        let smile: Double? = smiles.isEmpty ? nil : smiles.reduce(0, +) / Double(smiles.count)
        let quality = present.isEmpty ? 0 : present.reduce(0.0) { $0 + $1.quality } / Double(present.count)
        let motionFrames = present.filter { $0.t >= now - 3.0 }
        let headMotion = motionFrames.isEmpty ? 1.0
            : motionFrames.reduce(0.0) { $0 + $1.centerDelta } / Double(motionFrames.count)

        var blinkRate: Double? = nil
        if let since = faceSeenSince {
            let observed = Swift.min(60.0, now - since)
            if observed >= 10.0 {
                blinkRate = Double(blinkTimes.count) / observed * 60.0
            }
        }
        return FaceFeatures(presentFraction: presentFraction, blinkRatePerMin: blinkRate,
                            gazeOnScreen: gaze, smile: smile, headMotion: headMotion,
                            quality: quality, frames: recent.count)
    }

    // MARK: - Pure helpers

    static func toDouble(_ v: Any?) -> Double? {
        switch v {
        case let n as NSNumber: return n.doubleValue
        case let f as Float: return Double(f)
        case let d as Double: return d
        default: return nil
        }
    }

    /// Eye aspect ratio (height / width) in pixel space.
    static func aspectRatio(_ region: VNFaceLandmarkRegion2D?, size: CGSize) -> Double? {
        guard let r = region, r.pointCount >= 4 else { return nil }
        let pts = r.pointsInImage(imageSize: size)
        guard let minX = pts.map({ $0.x }).min(), let maxX = pts.map({ $0.x }).max(),
              let minY = pts.map({ $0.y }).min(), let maxY = pts.map({ $0.y }).max() else { return nil }
        let w = Double(maxX - minX)
        guard w > 1 else { return nil }
        return Double(maxY - minY) / w
    }

    /// Mean green (0..255) over forehead + cheek ROIs of a BGRA buffer.
    /// `box` is Vision-normalized (origin bottom-left).
    static func skinGreenMean(_ pb: CVPixelBuffer, box: CGRect) -> Double? {
        guard CVPixelBufferGetPixelFormatType(pb) == kCVPixelFormatType_32BGRA else { return nil }
        CVPixelBufferLockBaseAddress(pb, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(pb, .readOnly) }
        guard let base = CVPixelBufferGetBaseAddress(pb) else { return nil }
        let width = CVPixelBufferGetWidth(pb)
        let height = CVPixelBufferGetHeight(pb)
        let bpr = CVPixelBufferGetBytesPerRow(pb)
        let ptr = base.assumingMemoryBound(to: UInt8.self)

        // (u0, v0, u1, v1) inside the face box; v measured from the box bottom.
        let rois: [(Double, Double, Double, Double)] = [
            (0.30, 0.78, 0.70, 0.92), // forehead
            (0.15, 0.35, 0.35, 0.52), // left cheek
            (0.65, 0.35, 0.85, 0.52), // right cheek
        ]
        let bx = Double(box.minX), by = Double(box.minY)
        let bw = Double(box.width), bh = Double(box.height)
        var sum = 0
        var n = 0
        for roi in rois {
            let x0 = Int(((bx + roi.0 * bw) * Double(width)).rounded())
            let x1 = Int(((bx + roi.2 * bw) * Double(width)).rounded())
            let yTop = Int(((1.0 - (by + roi.3 * bh)) * Double(height)).rounded())
            let yBot = Int(((1.0 - (by + roi.1 * bh)) * Double(height)).rounded())
            let cx0 = Swift.max(0, Swift.min(width, x0))
            let cx1 = Swift.max(0, Swift.min(width, x1))
            let cy0 = Swift.max(0, Swift.min(height, yTop))
            let cy1 = Swift.max(0, Swift.min(height, yBot))
            guard cx1 > cx0, cy1 > cy0 else { continue }
            var y = cy0
            while y < cy1 {
                let row = y * bpr
                var x = cx0
                while x < cx1 {
                    sum += Int(ptr[row + x * 4 + 1])
                    n += 1
                    x += 2
                }
                y += 2
            }
        }
        guard n >= 50 else { return nil }
        return Double(sum) / Double(n)
    }
}
