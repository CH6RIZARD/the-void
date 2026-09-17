import Foundation
import AVFoundation
import UIKit

/// Orchestrates capture -> baseline z-scores -> estimator -> PrivacyGate -> emit.
///
/// Threading: all mutable controller state lives on `q` (serial). Capture classes are
/// internally synchronized; their callbacks hop onto `q` before touching state.
/// INVARIANT: raw buffers (IMU, frames, green series, RR) never leave this layer; the
/// only affect payload emitted is the PrivacyGate's quantized, DP-noised dictionary.
final class SensingController {
    typealias Emitter = (_ event: String, _ body: [String: Any]) -> Void

    private let q = DispatchQueue(label: "com.thevoid.sensing.controller")

    private let emitLock = NSLock()
    /// Events are delivered off `q` so a JS thread blocked in `q.sync` can never deadlock.
    private let emitQueue = DispatchQueue(label: "com.thevoid.sensing.emit")
    private var emitter: Emitter?

    private let consent: ConsentManager
    private let killSwitch: KillSwitch
    private let baselines: BaselineStore
    private let privacyGate: PrivacyGate
    private let estimator: AffectEstimating = HeuristicAffectEstimator()
    private let gate = MotionGate()
    private let attribution = Attribution()
    private let contextProvider = SensingContextProvider()
    private let motion = MotionCapture()
    private let touch = TouchCapture()
    private let rppg = RPPGCapture()
    private let face = FaceCapture()
    private let ppgSource = PPGCameraSource()

    // q-confined state
    private var ble: BleHeartRate?
    private var running = false
    private var feedVisible = true
    private var appActive = true
    private var faceActive = false
    private var calmActive = false
    private var timer: DispatchSourceTimer?
    private var tickCount = 0
    private var lastEmitted: [String: Any]?
    private var lastCalm: (bpm: Double, rmssd: Double?, atMs: Int64)?
    private var rppgOffset = 0.0
    private var lastBleSampleMs: Int64 = 0
    private var observers: [NSObjectProtocol] = []

    init() {
        VoidKeychain.resetIfFreshInstall()
        let c = ConsentManager()
        let k = KillSwitch()
        consent = c
        killSwitch = k
        baselines = BaselineStore()
        privacyGate = PrivacyGate(consent: c, killSwitch: k)

        let rppgRef = rppg
        face.onSkinSample = { t, green, quality in
            rppgRef.ingest(t: t, green: green, quality: quality)
        }
        let motionRef = motion
        ppgSource.motionEnergyProvider = { motionRef.energy()?.accelRMS }
        ppgSource.onUpdate = { [weak self] update in
            guard let self = self else { return }
            self.q.async { self.handleCalmUpdate(update) }
        }

        let center = NotificationCenter.default
        observers.append(center.addObserver(forName: UIApplication.didEnterBackgroundNotification,
                                            object: nil, queue: nil) { [weak self] _ in
            guard let self = self else { return }
            self.q.async {
                self.appActive = false
                if self.calmActive { self.cancelCalmLocked() }
                self.updateFaceLocked()
                self.baselines.flush()
            }
        })
        observers.append(center.addObserver(forName: UIApplication.willEnterForegroundNotification,
                                            object: nil, queue: nil) { [weak self] _ in
            guard let self = self else { return }
            self.q.async {
                self.appActive = true
                self.updateFaceLocked()
            }
        })
        contextProvider.refresh()
    }

    deinit {
        for o in observers { NotificationCenter.default.removeObserver(o) }
    }

    func setEmitter(_ e: Emitter?) {
        emitLock.lock()
        emitter = e
        emitLock.unlock()
    }

    private func emit(_ event: String, _ body: [String: Any]) {
        emitLock.lock()
        let e = emitter
        emitLock.unlock()
        guard let emitter = e else { return }
        emitQueue.async { emitter(event, body) }
    }

    // MARK: - Availability / context

    func isAvailable() -> Bool {
        return motion.isAvailable
    }

    func getContext() -> [String: Any] {
        return q.sync {
            var d = contextProvider.current().toDictionary()
            d["running"] = running
            d["feedVisible"] = feedVisible
            d["faceActive"] = faceActive
            d["calmReadingActive"] = calmActive
            d["bleConnected"] = ble?.isConnected ?? false
            d["killSwitchEnabled"] = killSwitch.isEnabled
            d["motionAvailable"] = motion.isAvailable
            return d
        }
    }

    // MARK: - Consent

    func getConsent() -> [String: Any] {
        return consent.snapshot().toDictionary()
    }

    /// Requests OS permissions needed by the tiers, records app consent for the tiers the
    /// OS allowed, and completes with the ConsentState dictionary. Empty tiers = "Not now".
    func requestConsent(_ rawTiers: [String], completion: @escaping ([String: Any]) -> Void) {
        let tiers = ConsentManager.parse(rawTiers)
        let declined = rawTiers.isEmpty
        let wantsCamera = tiers.contains(.face) || tiers.contains(.ppg)

        let proceed: (Bool) -> Void = { [weak self] cameraGranted in
            guard let self = self else {
                completion(ConsentSnapshot(tiers: [], hasChosen: false, nonBiometricFeed: false).toDictionary())
                return
            }
            self.q.async {
                var granted = tiers
                if wantsCamera && !cameraGranted {
                    granted.removeAll { $0 == .face || $0 == .ppg }
                }
                if granted.contains(.ble) {
                    if BleHeartRate.isDenied {
                        granted.removeAll { $0 == .ble }
                    } else if self.ble == nil {
                        // Creating the central triggers the Bluetooth permission prompt.
                        self.ble = self.makeBle()
                    }
                }
                let snap = declined ? self.consent.declineAll() : self.consent.grant(granted)
                if self.running {
                    self.applyTiersLocked()
                }
                completion(snap.toDictionary())
            }
        }

        guard wantsCamera else {
            proceed(true)
            return
        }
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            proceed(true)
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { ok in proceed(ok) }
        default:
            proceed(false)
        }
    }

    func revokeConsent(_ rawTiers: [String]) -> [String: Any] {
        return q.sync {
            let snap = consent.revoke(ConsentManager.parse(rawTiers))
            if !snap.affectConsent {
                stopLocked()
            } else if running {
                applyTiersLocked()
            }
            return snap.toDictionary()
        }
    }

    // MARK: - Kill switch

    func setKillSwitch(_ enabled: Bool) {
        killSwitch.set(enabled)
        if !enabled {
            q.async {
                self.cancelCalmLocked()
                self.stopLocked()
            }
        }
    }

    func isKillSwitchEnabled() -> Bool {
        return killSwitch.isEnabled
    }

    // MARK: - Lifecycle

    func start() {
        q.sync { startLocked() }
    }

    func stop() {
        q.sync { stopLocked() }
    }

    func shutdown() {
        setEmitter(nil)
        q.sync {
            cancelCalmLocked()
            stopLocked()
        }
    }

    func setFeedVisible(_ visible: Bool) {
        q.async {
            self.feedVisible = visible
            self.updateFaceLocked()
        }
    }

    private func startLocked() {
        let snap = consent.snapshot()
        guard snap.affectConsent, killSwitch.isEnabled else { return }
        if running {
            applyTiersLocked()
            return
        }
        running = true
        contextProvider.refresh()
        privacyGate.resetTrajectory()
        applyTiersLocked()
        let t = DispatchSource.makeTimerSource(queue: q)
        t.schedule(deadline: .now() + 1.0, repeating: 1.0, leeway: .milliseconds(100))
        t.setEventHandler { [weak self] in self?.tickLocked() }
        timer?.cancel()
        timer = t
        t.resume()
    }

    private func stopLocked() {
        running = false
        timer?.cancel()
        timer = nil
        motion.stop()
        updateFaceLocked()
        ble?.disconnect(forget: false)
        touch.clear()
        rppg.reset()
        attribution.clear()
        privacyGate.resetTrajectory()
        baselines.flush()
        lastEmitted = nil
    }

    /// Bring captures in line with current consent + running state.
    private func applyTiersLocked() {
        let snap = consent.snapshot()
        if running && snap.has(.motion) { motion.start() } else { motion.stop() }
        if !snap.has(.touch) { touch.clear() }
        if running && snap.has(.ble) && !BleHeartRate.isDenied {
            if ble == nil { ble = makeBle() }
            if !(ble?.isConnected ?? false) { ble?.reconnectSaved() }
        } else if !snap.has(.ble) {
            ble?.disconnect(forget: false)
        }
        updateFaceLocked()
    }

    private func updateFaceLocked() {
        let want = running && feedVisible && appActive && !calmActive
            && killSwitch.isEnabled
            && consent.snapshot().has(.face)
            && AVCaptureDevice.authorizationStatus(for: .video) == .authorized
        if want && !faceActive {
            face.start()
            faceActive = true
        } else if !want && faceActive {
            face.stop()
            faceActive = false
            rppg.reset()
        }
    }

    // MARK: - Attribution / touch / state

    func markImpression(impressionId: String, itemId: String) {
        attribution.markImpression(impressionId: impressionId, itemId: itemId)
    }

    func recordTouch(_ samples: [[String: Any]]) {
        guard killSwitch.isEnabled, consent.snapshot().has(.touch) else { return }
        touch.ingest(samples)
    }

    func getAffectState() -> [String: Any]? {
        return q.sync { lastEmitted }
    }

    // MARK: - Tick (q)

    private func tickLocked() {
        tickCount += 1
        if tickCount % 10 == 1 { contextProvider.refresh() }
        let ctx = contextProvider.current()
        face.setLowPower(ctx.isLowBattery)

        let snap = consent.snapshot()
        guard running, snap.affectConsent, killSwitch.isEnabled else { return }

        let nowMs = vsNowMs()
        var w = AffectWindow(windowEndMs: nowMs)
        w.context = ctx
        var factors: [Double] = []

        func observe(_ signal: String, _ value: Double) -> Double? {
            let r = baselines.observe(signal, value: value, atMs: nowMs)
            if r.z != nil { factors.append(r.factor) }
            return r.z
        }

        // Motion (gate first: a rejected window is DISCARDED, never imputed).
        var deviceStill: Bool? = nil
        if snap.has(.motion), let m = motion.energy() {
            let g = gate.evaluate(m.accelRMS)
            guard g.passed else { return }
            deviceStill = gate.isStill(m.accelRMS)
            w.motionZ = observe("motion", m.accelRMS)
            w.tremorZ = observe("tremor", m.rotationRMS)
            w.sourceMask |= AffectSource.motion
        }

        // Touch kinematics.
        if snap.has(.touch), let tf = touch.features(nowMs: Double(nowMs)) {
            w.touchQuality = Swift.min(1.0, Double(tf.eventCount) / 20.0)
            w.touchSpeedZ = observe("touch.speed", tf.speedMean)
            w.touchSpeedVarZ = observe("touch.speedStd", tf.speedStd)
            w.reversalRateZ = observe("touch.reversals", tf.reversalRate)
            w.tapRateZ = observe("touch.taps", tf.tapRate)
            w.pauseRatioZ = observe("touch.pause", tf.pauseRatio)
            if let p = tf.pressureMean { w.pressureZ = observe("touch.pressure", p) }
            w.sourceMask |= AffectSource.touch
        }

        // Face.
        var headStill = false
        if faceActive, let ff = face.features(), ff.presentFraction >= 0.3 {
            w.faceQuality = ff.quality * ff.presentFraction
            w.gazeOnScreen = ff.gazeOnScreen
            w.gazeZ = observe("face.gaze", ff.gazeOnScreen)
            if let b = ff.blinkRatePerMin { w.blinkRateZ = observe("face.blink", b) }
            if let s = ff.smile { w.smileZ = observe("face.smile", s) }
            headStill = ff.headMotion < 0.015 && ff.presentFraction >= 0.8
            w.sourceMask |= AffectSource.face
        }

        // Heart rate: BLE strap > recent calm reading > face rPPG.
        var hrBpm: Double? = nil
        var hrRmssd: Double? = nil
        var hrConf = 0.0
        var hrBit = 0
        var hrFresh = false
        if snap.has(.ble), let b = ble?.latest(maxAgeSec: 5) {
            hrBpm = b.bpm
            hrRmssd = b.rmssdMs
            hrConf = b.contact ? 0.95 : 0.5
            hrBit = AffectSource.watch
            hrFresh = b.sampleMs != lastBleSampleMs
            lastBleSampleMs = b.sampleMs
        } else if let c = lastCalm, nowMs - c.atMs < 120_000 {
            hrBpm = c.bpm
            hrRmssd = c.rmssd
            hrConf = 0.8
            hrBit = AffectSource.ppg
            hrFresh = false // folded into the baseline once, when the reading finished
        } else if faceActive, (deviceStill ?? true), headStill, let r = rppg.estimate(still: true) {
            if let c = lastCalm, nowMs - c.atMs < 600_000, r.quality >= 0.6 {
                // Calibrate the rPPG offset against the fingertip reference.
                rppgOffset = 0.8 * rppgOffset + 0.2 * vsClamp(c.bpm - r.bpm, -10, 10)
            }
            hrBpm = r.bpm + rppgOffset
            hrConf = 0.55 * r.quality
            hrBit = AffectSource.ppg | AffectSource.face
            hrFresh = true
        }
        if let bpm = hrBpm {
            if hrFresh {
                w.hrZ = observe("hr", bpm)
                if let rm = hrRmssd { w.hrvZ = observe("hrv", rm) }
            } else {
                if let z = baselines.z("hr", value: bpm, atMs: nowMs) {
                    w.hrZ = z
                    factors.append(baselines.baseline("hr", atMs: nowMs)?.confidenceFactor ?? 0)
                }
                if let rm = hrRmssd, let z = baselines.z("hrv", value: rm, atMs: nowMs) {
                    w.hrvZ = z
                    factors.append(baselines.baseline("hrv", atMs: nowMs)?.confidenceFactor ?? 0)
                }
            }
            if w.hrZ != nil || w.hrvZ != nil {
                w.hrConfidence = hrConf
                w.sourceMask |= hrBit
            }
        }

        w.baselineWarm = !factors.isEmpty
        w.baselineFactor = factors.isEmpty ? 0 : factors.reduce(0, +) / Double(factors.count)

        guard let local = estimator.estimate(w) else { return }
        let imp = attribution.impressionId(forWindowEndMs: nowMs)
        guard let out = privacyGate.produce(local, impressionId: imp) else { return }
        lastEmitted = out
        emit("onAffect", out)
    }

    // MARK: - Calm reading (fingertip PPG)

    func startCalmReading() -> Bool {
        return q.sync { startCalmLocked() }
    }

    func stopCalmReading() {
        q.async { self.cancelCalmLocked() }
    }

    private func startCalmLocked() -> Bool {
        guard killSwitch.isEnabled else {
            emit("onCalmReading", ["done": true, "progress": 0, "valid": false, "error": "kill_switch"])
            return false
        }
        guard consent.snapshot().has(.ppg) else {
            emit("onCalmReading", ["done": true, "progress": 0, "valid": false, "error": "no_consent"])
            return false
        }
        guard AVCaptureDevice.authorizationStatus(for: .video) == .authorized else {
            emit("onCalmReading", ["done": true, "progress": 0, "valid": false, "error": "camera_denied"])
            return false
        }
        if calmActive { return true }
        calmActive = true
        let hadFace = faceActive
        updateFaceLocked() // release the front camera first
        let delay: Double = hadFace ? 0.4 : 0.0
        q.asyncAfter(deadline: .now() + delay) {
            guard self.calmActive else { return }
            if !self.ppgSource.start() {
                self.calmActive = false
                self.emit("onCalmReading", ["done": true, "progress": 0, "valid": false, "error": "camera_unavailable"])
                self.updateFaceLocked()
            }
        }
        return true
    }

    private func cancelCalmLocked() {
        guard calmActive else { return }
        calmActive = false
        ppgSource.stop()
        emit("onCalmReading", ["done": true, "progress": 0, "valid": false, "cancelled": true])
        updateFaceLocked()
    }

    private func handleCalmUpdate(_ u: CalmReadingUpdate) {
        guard calmActive else { return }
        emit("onCalmReading", u.toDictionary())
        guard u.done else { return }
        calmActive = false
        if u.valid, let bpm = u.bpm {
            let now = vsNowMs()
            lastCalm = (bpm: bpm, rmssd: u.hrvMs, atMs: now)
            baselines.update("hr", value: bpm, atMs: now)
            if let hrv = u.hrvMs { baselines.update("hrv", value: hrv, atMs: now) }
        }
        updateFaceLocked()
    }

    // MARK: - BLE heart rate

    private func makeBle() -> BleHeartRate {
        let b = BleHeartRate()
        b.onDevice = { [weak self] info in self?.emitBle(info) }
        return b
    }

    /// Same JS contract as Android: "onBleDevice" {id,name,rssi} only for discoveries,
    /// everything else is "onBleStatus" {status,id,message}.
    private func emitBle(_ info: [String: Any]) {
        let state = info["state"] as? String ?? "unknown"
        let id: Any = info["id"] ?? NSNull()
        func status(_ s: String, _ message: Any = NSNull()) {
            emit("onBleStatus", ["status": s, "id": id, "message": message])
        }
        switch state {
        case "discovered":
            emit("onBleDevice", [
                "id": info["id"] ?? "",
                "name": info["name"] ?? NSNull(),
                "rssi": info["rssi"] ?? 0,
            ])
        case "connecting", "connected", "disconnected":
            status(state)
        case "scanComplete":
            status("scanDone")
        case "failed":
            status("error", "connection failed")
        case "notFound":
            status("error", "device not found")
        case "no_consent":
            status("error", "heart-rate strap not enabled")
        case "poweredOff", "unauthorized", "unsupported":
            status("error", "bluetooth \(state)")
        default:
            break // poweredOn / resetting / unknown: not user-visible
        }
    }

    func scanHeartRateDevices() -> Bool {
        return q.sync {
            guard killSwitch.isEnabled, consent.snapshot().has(.ble), !BleHeartRate.isDenied else {
                emitBle(["state": "no_consent"])
                return false
            }
            if ble == nil { ble = makeBle() }
            ble?.scan(seconds: 15)
            emit("onBleStatus", ["status": "scanning", "id": NSNull(), "message": NSNull()])
            return true
        }
    }

    func connectHeartRate(_ id: String) -> Bool {
        return q.sync {
            guard killSwitch.isEnabled, consent.snapshot().has(.ble), !BleHeartRate.isDenied else { return false }
            if ble == nil { ble = makeBle() }
            return ble?.connect(id: id) ?? false
        }
    }

    func disconnectHeartRate() {
        q.async { self.ble?.disconnect(forget: true) }
    }
}
