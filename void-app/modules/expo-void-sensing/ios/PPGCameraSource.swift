import Foundation
import AVFoundation
import CoreMedia
import CoreVideo

/// Progress / result of a 30 s "calm reading" (fingertip on rear camera + torch).
struct CalmReadingUpdate {
    var bpm: Double?
    var hrvMs: Double?
    /// 0..1 of finger-on time collected.
    var progress: Double
    var done: Bool
    var fingerDetected: Bool
    var quality: Double
    var valid: Bool
    var error: String?

    func toDictionary() -> [String: Any] {
        var d: [String: Any] = [
            "progress": progress,
            "done": done,
            "fingerDetected": fingerDetected,
            "quality": quality,
            "valid": valid,
        ]
        if let bpm = bpm { d["bpm"] = (bpm * 10).rounded() / 10 }
        if let hrv = hrvMs { d["hrv"] = (hrv * 10).rounded() / 10 }
        if let e = error { d["error"] = e }
        return d
    }
}

/// Rear camera + torch source for contact PPG. Averages red and green over a centre
/// ROI per frame; the scalar series stays on-device (only bpm/hrv/progress leave).
/// Frames are never stored.
final class PPGCameraSource: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate {
    static let durationSeconds = 30.0
    static let timeoutSeconds = 75.0

    var onUpdate: ((CalmReadingUpdate) -> Void)?
    var motionEnergyProvider: (() -> Double?)?

    private let sessionQueue = DispatchQueue(label: "com.thevoid.sensing.ppg.session")
    private let frameQueue = DispatchQueue(label: "com.thevoid.sensing.ppg.frames")
    private let estimator = PPGCapture()

    // sessionQueue state
    private var session: AVCaptureSession?
    private var device: AVCaptureDevice?

    // frameQueue state
    private var active = false
    private var times: [Double] = []
    private var reds: [Double] = []
    private var greens: [Double] = []
    private var fingerSeconds = 0.0
    private var lastFrameT: Double? = nil
    private var lastFingerFrameT: Double? = nil
    private var fingerNow = false
    private var startedAt = Date()
    private var timer: DispatchSourceTimer?

    /// Starts a reading. Returns false when the camera is unavailable/unauthorized.
    func start() -> Bool {
        guard AVCaptureDevice.authorizationStatus(for: .video) == .authorized,
              AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back) != nil else {
            return false
        }
        frameQueue.sync {
            self.resetLocked()
            self.active = true
            self.startedAt = Date()
            let t = DispatchSource.makeTimerSource(queue: self.frameQueue)
            t.schedule(deadline: .now() + 1.0, repeating: 1.0)
            t.setEventHandler { [weak self] in self?.tickLocked() }
            self.timer = t
            t.resume()
        }
        sessionQueue.async { [weak self] in self?.startSession() }
        return true
    }

    /// Cancels a reading (no final result). Torch off, camera released.
    func stop() {
        frameQueue.async { [weak self] in
            guard let self = self else { return }
            self.active = false
            self.timer?.cancel()
            self.timer = nil
            self.resetLocked()
        }
        sessionQueue.async { [weak self] in self?.stopSession() }
    }

    // MARK: - Session (sessionQueue)

    private func startSession() {
        guard session == nil,
              let dev = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back) else { return }
        let s = AVCaptureSession()
        s.beginConfiguration()
        if s.canSetSessionPreset(.vga640x480) {
            s.sessionPreset = .vga640x480
        } else if s.canSetSessionPreset(.low) {
            s.sessionPreset = .low
        }
        guard let input = try? AVCaptureDeviceInput(device: dev), s.canAddInput(input) else {
            s.commitConfiguration()
            failFromSession("camera_unavailable")
            return
        }
        s.addInput(input)
        let output = AVCaptureVideoDataOutput()
        output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: NSNumber(value: kCVPixelFormatType_32BGRA)]
        output.alwaysDiscardsLateVideoFrames = true
        output.setSampleBufferDelegate(self, queue: frameQueue)
        guard s.canAddOutput(output) else {
            s.commitConfiguration()
            failFromSession("camera_unavailable")
            return
        }
        s.addOutput(output)
        s.commitConfiguration()

        PPGCameraSource.setFrameRate(dev, fps: 30)
        session = s
        device = dev
        s.startRunning()

        // Torch must be enabled after the session runs.
        do {
            try dev.lockForConfiguration()
            if dev.hasTorch && dev.isTorchAvailable {
                let level = Swift.min(1.0, AVCaptureDevice.maxAvailableTorchLevel)
                do {
                    try dev.setTorchModeOn(level: level > 0 ? level : 1.0)
                } catch {
                    if dev.isTorchModeSupported(.on) { dev.torchMode = .on }
                }
            }
            if dev.isFocusModeSupported(.locked) { dev.focusMode = .locked }
            dev.unlockForConfiguration()
        } catch {
            // Torchless reading still works in bright light; quality will reflect it.
        }

        // Lock exposure / white balance once auto-exposure settled on the lit fingertip,
        // so AE does not fight the pulsatile signal.
        sessionQueue.asyncAfter(deadline: .now() + 2.0) { [weak self] in
            guard let self = self, let d = self.device, self.session != nil else { return }
            do {
                try d.lockForConfiguration()
                if d.isExposureModeSupported(.locked) { d.exposureMode = .locked }
                if d.isWhiteBalanceModeSupported(.locked) { d.whiteBalanceMode = .locked }
                d.unlockForConfiguration()
            } catch {}
        }
    }

    private func stopSession() {
        if let dev = device {
            do {
                try dev.lockForConfiguration()
                if dev.hasTorch && dev.torchMode != .off { dev.torchMode = .off }
                if dev.isExposureModeSupported(.continuousAutoExposure) { dev.exposureMode = .continuousAutoExposure }
                if dev.isWhiteBalanceModeSupported(.continuousAutoWhiteBalance) { dev.whiteBalanceMode = .continuousAutoWhiteBalance }
                if dev.isFocusModeSupported(.continuousAutoFocus) { dev.focusMode = .continuousAutoFocus }
                dev.unlockForConfiguration()
            } catch {}
        }
        if let s = session {
            if s.isRunning { s.stopRunning() }
            for o in s.outputs { s.removeOutput(o) }
            for i in s.inputs { s.removeInput(i) }
        }
        session = nil
        device = nil
    }

    private func failFromSession(_ reason: String) {
        frameQueue.async { [weak self] in
            guard let self = self, self.active else { return }
            self.finishLocked(error: reason)
        }
    }

    static func setFrameRate(_ device: AVCaptureDevice, fps: Double) {
        let supported = device.activeFormat.videoSupportedFrameRateRanges.contains {
            $0.minFrameRate <= fps && fps <= $0.maxFrameRate
        }
        guard supported else { return }
        do {
            try device.lockForConfiguration()
            let d = CMTime(value: 1, timescale: CMTimeScale(fps))
            device.activeVideoMinFrameDuration = d
            device.activeVideoMaxFrameDuration = d
            device.unlockForConfiguration()
        } catch {}
    }

    // MARK: - Frames (frameQueue)

    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        guard active, let pb = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        let t = CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(sampleBuffer))
        guard t.isFinite else { return }
        guard let rg = PPGCameraSource.meanRedGreen(pb) else { return }
        let r = rg.red
        let g = rg.green

        // Fingertip covering a lit lens reads strongly red.
        let finger = r > 90 && r > 1.6 * g
        if let last = lastFrameT, finger, fingerNow {
            fingerSeconds += Swift.max(0, Swift.min(0.2, t - last))
        }
        lastFrameT = t
        fingerNow = finger

        if finger {
            // A gap of > 1 s without the finger invalidates the continuous series.
            if let lf = lastFingerFrameT, t - lf > 1.0 {
                times.removeAll(); reds.removeAll(); greens.removeAll()
            }
            lastFingerFrameT = t
            times.append(t)
            reds.append(r)
            greens.append(g)
            if times.count > 3000 {
                times.removeFirst(); reds.removeFirst(); greens.removeFirst()
            }
        }
    }

    /// Mean red/green (0..255) over the centre 50% of a BGRA buffer, 4-px stride.
    static func meanRedGreen(_ pb: CVPixelBuffer) -> (red: Double, green: Double)? {
        guard CVPixelBufferGetPixelFormatType(pb) == kCVPixelFormatType_32BGRA else { return nil }
        CVPixelBufferLockBaseAddress(pb, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(pb, .readOnly) }
        guard let base = CVPixelBufferGetBaseAddress(pb) else { return nil }
        let width = CVPixelBufferGetWidth(pb)
        let height = CVPixelBufferGetHeight(pb)
        let bpr = CVPixelBufferGetBytesPerRow(pb)
        guard width > 8, height > 8 else { return nil }
        let ptr = base.assumingMemoryBound(to: UInt8.self)
        let x0 = width / 4, x1 = width * 3 / 4
        let y0 = height / 4, y1 = height * 3 / 4
        var sumR = 0, sumG = 0, n = 0
        var y = y0
        while y < y1 {
            let row = y * bpr
            var x = x0
            while x < x1 {
                let o = row + x * 4
                sumG += Int(ptr[o + 1])
                sumR += Int(ptr[o + 2])
                n += 1
                x += 4
            }
            y += 4
        }
        guard n > 0 else { return nil }
        return (red: Double(sumR) / Double(n), green: Double(sumG) / Double(n))
    }

    // MARK: - Progress (frameQueue)

    private func tickLocked() {
        guard active else { return }
        let elapsed = Date().timeIntervalSince(startedAt)
        let progress = vsClamp(fingerSeconds / PPGCameraSource.durationSeconds, 0, 1)

        if progress >= 1.0 {
            finishLocked(error: nil)
            return
        }
        if elapsed >= PPGCameraSource.timeoutSeconds {
            finishLocked(error: fingerSeconds < 5 ? "no_finger" : "timeout")
            return
        }

        var update = CalmReadingUpdate(bpm: nil, hrvMs: nil, progress: progress, done: false,
                                       fingerDetected: fingerNow, quality: 0, valid: false, error: nil)
        if let last = times.last, let first = times.first, last - first >= 8.0 {
            // Interim estimate over the trailing 10 s (green only, cheap).
            let startIdx = times.firstIndex(where: { $0 >= last - 10.0 }) ?? 0
            let reading = estimator.estimate(times: Array(times[startIdx...]),
                                             values: Array(greens[startIdx...]),
                                             motionEnergy: nil, windowEndMs: vsNowMs())
            if reading.valid {
                update.bpm = reading.bpm
                update.quality = reading.quality
            }
        }
        onUpdate?(update)
    }

    private func finishLocked(error: String?) {
        active = false
        timer?.cancel()
        timer = nil

        var update = CalmReadingUpdate(bpm: nil, hrvMs: nil, progress: vsClamp(fingerSeconds / PPGCameraSource.durationSeconds, 0, 1),
                                       done: true, fingerDetected: fingerNow, quality: 0, valid: false, error: error)
        if error == nil {
            let motion = motionEnergyProvider?()
            let now = vsNowMs()
            let g = estimator.estimate(times: times, values: greens, motionEnergy: motion, windowEndMs: now)
            let r = estimator.estimate(times: times, values: reds, motionEnergy: motion, windowEndMs: now)
            let candidates = [g, r].filter { $0.valid }
            if let best = candidates.max(by: { $0.snrDb < $1.snrDb }) {
                update.bpm = best.bpm
                update.hrvMs = best.rmssdMs
                update.quality = best.quality
                update.valid = true
            } else {
                update.error = "low_quality"
            }
        }
        resetLocked()
        sessionQueue.async { [weak self] in self?.stopSession() }
        onUpdate?(update)
    }

    private func resetLocked() {
        times.removeAll()
        reds.removeAll()
        greens.removeAll()
        fingerSeconds = 0
        lastFrameT = nil
        lastFingerFrameT = nil
        fingerNow = false
    }
}
