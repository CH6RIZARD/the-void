package com.thevoid.sensing

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.hardware.Sensor
import android.hardware.SensorManager
import android.util.Log
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import com.thevoid.sensing.affect.AffectWindow
import com.thevoid.sensing.affect.ContextInputs
import com.thevoid.sensing.affect.FaceInputs
import com.thevoid.sensing.affect.HeartInputs
import com.thevoid.sensing.affect.TFLiteAffectEstimator
import com.thevoid.sensing.affect.TouchInputs
import com.thevoid.sensing.capture.BleHeartRate
import com.thevoid.sensing.capture.CalmReadingSession
import com.thevoid.sensing.capture.ContextCapture
import com.thevoid.sensing.capture.FaceCapture
import com.thevoid.sensing.capture.MotionCapture
import com.thevoid.sensing.capture.RPPGCapture
import com.thevoid.sensing.capture.TouchCapture
import com.thevoid.sensing.capture.TouchEvent
import com.thevoid.sensing.pipeline.BaselineStore
import com.thevoid.sensing.pipeline.ImpressionTracker
import com.thevoid.sensing.pipeline.MotionGate
import com.thevoid.sensing.pipeline.SignalKind
import com.thevoid.sensing.privacy.ConsentManager
import com.thevoid.sensing.privacy.ConsentSnapshot
import com.thevoid.sensing.privacy.DPMechanism
import com.thevoid.sensing.privacy.EmittedAffectState
import com.thevoid.sensing.privacy.KillSwitch
import com.thevoid.sensing.privacy.PrivacyGate
import com.thevoid.sensing.privacy.SensorTier
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

// MARK: - Record types (JS bridge shapes; must match index.ts field names exactly)

/** One touch sample from the WebView bridge. index.ts `TouchSample`. */
class TouchSampleRecord : Record {
    /** Normalized [0,1] viewport x. */
    @Field var x: Double = 0.0
    /** Normalized [0,1] viewport y. */
    @Field var y: Double = 0.0
    /** Milliseconds (any monotonic JS clock, e.g. performance.now()). */
    @Field var t: Double = 0.0
    /** "start" | "move" | "end". */
    @Field var phase: String = "move"
    @Field var pressure: Double = 0.0
}

/**
 * expo-void-sensing (Android). The ONLY bridge between the on-device sensing/affect
 * pipeline and JS. Raw physiological data (IMU, camera frames, green-channel series,
 * RR intervals) NEVER crosses this boundary. JS receives:
 *  - onAffect: the quantized, DP-noised AffectState
 *  - onCalmReading: the user-requested calm reading result (bpm/hrv shown to the user)
 *  - onBleDevice / onBleStatus: device discovery + connection state (no readings)
 */
class ExpoVoidSensingModule : Module() {

    private var ctx: Context? = null

    // Capture.
    private var motionCapture: MotionCapture? = null
    private val touchCapture = TouchCapture()
    private val touchLock = Any()
    private val touchEvents = ArrayDeque<TouchEvent>()
    @Volatile private var lastTouchWallMs = 0L
    private var contextCapture: ContextCapture? = null
    @Volatile private var faceCapture: FaceCapture? = null
    private val rppg = RPPGCapture()
    @Volatile private var ble: BleHeartRate? = null
    @Volatile private var calm: CalmReadingSession? = null
    private var calmJob: Job? = null
    /** Live calm-reading bpm (value, atMs) while a reading is running. */
    @Volatile private var calmLive: Pair<Double, Long>? = null

    // Pipeline.
    private var baselineStore: BaselineStore? = null
    private val motionGate = MotionGate()
    private val impressions = ImpressionTracker()

    // Privacy.
    private var consentManager: ConsentManager? = null
    private var killSwitch: KillSwitch? = null
    private var privacyGate: PrivacyGate? = null

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private var loopJob: Job? = null
    private var tickCount = 0L

    @Volatile private var lastEmitted: EmittedAffectState? = null
    /** JS started the pipeline (start()). */
    @Volatile private var running = false
    /** JS says the feed is visible (face capture wanted). */
    @Volatile private var feedVisible = false
    /** The host activity is in the foreground. */
    @Volatile private var inForeground = true

    override fun definition() = ModuleDefinition {
        Name("ExpoVoidSensing")

        Events(EVENT_AFFECT, EVENT_CALM, EVENT_BLE_DEVICE, EVENT_BLE_STATUS)

        OnCreate {
            val c = appContext.reactContext
            ctx = c
            motionCapture = MotionCapture(c)
            contextCapture = ContextCapture(c)
            baselineStore = BaselineStore(c)
            val cm = ConsentManager(c)
            val ks = KillSwitch(c)
            consentManager = cm
            killSwitch = ks
            privacyGate = PrivacyGate(cm, ks, TFLiteAffectEstimator.load(c), DPMechanism())
        }

        OnDestroy {
            stopInternal()
            scope.cancel()
        }

        OnActivityEntersBackground {
            inForeground = false
            stopFace()
            if (calm != null) stopCalm(emitFinal = false, error = "interrupted")
        }

        OnActivityEntersForeground {
            inForeground = true
            updateFace()
        }

        Function("isAvailable") {
            isAvailableInternal()
        }

        // Sets the consented tiers to exactly `tiers` and marks the choice as made.
        AsyncFunction("requestConsent") { tiers: List<String> ->
            val cm = consentManager
            if (cm == null) {
                emptyConsent()
            } else {
                val snap = cm.setTiers(tiers.mapNotNull { SensorTier.fromJs(it) })
                applyConsent(snap)
                snap.toMap()
            }
        }

        AsyncFunction("revokeConsent") { tiers: List<String> ->
            val cm = consentManager
            if (cm == null) {
                emptyConsent()
            } else {
                val snap = cm.revoke(tiers.mapNotNull { SensorTier.fromJs(it) })
                applyConsent(snap)
                snap.toMap()
            }
        }

        Function("chooseNonBiometric") {
            val cm = consentManager
            if (cm == null) {
                emptyConsent()
            } else {
                val snap = cm.chooseNonBiometric()
                applyConsent(snap)
                snap.toMap()
            }
        }

        Function("getConsent") {
            consentManager?.snapshot()?.toMap() ?: emptyConsent()
        }

        Function("setKillSwitch") { enabled: Boolean ->
            killSwitch?.set(enabled)
            if (!enabled) {
                stopInternal()
            }
        }

        Function("isKillSwitchEnabled") {
            killSwitch?.isEnabled() ?: true
        }

        AsyncFunction("start") {
            startInternal()
        }

        AsyncFunction("stop") {
            stopInternal()
        }

        Function("getAffectState") {
            lastEmitted?.toMap()
        }

        Function("markImpression") { impressionId: String, itemId: String ->
            impressions.mark(impressionId, itemId, System.currentTimeMillis())
        }

        Function("recordTouch") { samples: List<TouchSampleRecord> ->
            recordTouchInternal(samples)
        }

        Function("startCalmReading") {
            startCalm()
        }

        Function("stopCalmReading") {
            stopCalm(emitFinal = true)
        }

        Function("scanHeartRateDevices") {
            scanBle()
        }

        Function("connectHeartRate") { id: String ->
            connectBle(id)
        }

        Function("disconnectHeartRate") {
            ble?.disconnect()
            Unit
        }

        Function("setFeedVisible") { visible: Boolean ->
            feedVisible = visible
            updateFace()
        }

        Function("getContext") {
            (contextCapture ?: ContextCapture(ctx)).snapshot().toMap()
        }
    }

    // MARK: - Lifecycle

    private fun isAvailableInternal(): Boolean {
        val c = ctx ?: return false
        val sm = c.getSystemService(Context.SENSOR_SERVICE) as? SensorManager ?: return false
        return sm.getDefaultSensor(Sensor.TYPE_LINEAR_ACCELERATION) != null ||
            sm.getDefaultSensor(Sensor.TYPE_ACCELEROMETER) != null
    }

    private fun emptyConsent(): Map<String, Any?> = mapOf(
        "affectConsent" to false,
        "perTier" to SensorTier.values().associate { it.jsKey to false },
        "nonBiometricFeed" to false,
        "hasChosen" to false,
    )

    private fun consented(tier: SensorTier): Boolean = consentManager?.isConsented(tier) == true

    private fun killOn(): Boolean = killSwitch?.isEnabled() == false

    /** Stop anything whose tier was just revoked; start what is now allowed. */
    private fun applyConsent(snap: ConsentSnapshot) {
        if (snap.perTier[SensorTier.MOTION] != true) {
            motionCapture?.stop()
        } else if (running) {
            motionCapture?.start()
        }
        if (snap.perTier[SensorTier.TOUCH] != true) {
            synchronized(touchLock) { touchEvents.clear() }
        }
        if (snap.perTier[SensorTier.PPG] != true && calm != null) stopCalm(emitFinal = false)
        if (snap.perTier[SensorTier.BLE] != true) ble?.disconnect()
        updateFace()
    }

    private fun startInternal() {
        val ks = killSwitch ?: return
        if (!ks.isEnabled()) return
        running = true
        if (consented(SensorTier.MOTION)) motionCapture?.start()
        contextCapture?.start()
        privacyGate?.resetNoiseCentre()
        if (loopJob?.isActive != true) {
            loopJob = scope.launch {
                while (isActive) {
                    try {
                        tick()
                    } catch (t: Throwable) {
                        Log.w(TAG, "tick failed: ${t.message}")
                    }
                    delay(TICK_MS)
                }
            }
        }
        updateFace()
    }

    private fun stopInternal() {
        running = false
        motionCapture?.stop()
        contextCapture?.stop()
        stopFace()
        if (calm != null) stopCalm(emitFinal = false)
        ble?.stopScan()
        if (killOn()) ble?.disconnect()
        loopJob?.cancel()
        loopJob = null
        baselineStore?.flush()
    }

    // MARK: - Permissions (requested from JS via PermissionsAndroid; checked here)

    private fun hasPermission(permission: String): Boolean {
        val c = ctx ?: return false
        return ContextCompat.checkSelfPermission(c, permission) == PackageManager.PERMISSION_GRANTED
    }

    private fun lifecycleOwner(): LifecycleOwner? = appContext.currentActivity as? LifecycleOwner

    // MARK: - Face (front camera) + rPPG

    private fun updateFace() {
        val want = running && feedVisible && inForeground && !killOn() &&
            consented(SensorTier.FACE) && calm == null
        if (want) startFace() else stopFace()
    }

    private fun startFace() {
        if (faceCapture?.isRunning == true) return
        val c = ctx ?: return
        if (!hasPermission(Manifest.permission.CAMERA)) {
            Log.i(TAG, "face tier consented but CAMERA permission not granted")
            return
        }
        val owner = lifecycleOwner() ?: return
        val fc = faceCapture ?: FaceCapture(
            c,
            onGreen = { tMs, g -> rppg.push(tMs, g) },
            onError = { msg -> Log.w(TAG, "face capture: $msg") },
        ).also { faceCapture = it }
        try {
            fc.start(owner)
        } catch (t: Throwable) {
            Log.w(TAG, "face start failed: ${t.message}")
        }
    }

    private fun stopFace() {
        val fc = faceCapture ?: return
        if (fc.isRunning) {
            try {
                fc.stop()
            } catch (t: Throwable) {
                // ignore
            }
        }
        rppg.clear()
    }

    // MARK: - Calm reading (rear camera + torch, explicit, 30 s)

    /** Returns false (and emits a done event with no bpm) when it cannot start. */
    private fun startCalm(): Boolean {
        if (calm != null) return true
        val c = ctx
        val owner = lifecycleOwner()
        val allowed = c != null && owner != null && !killOn() &&
            consented(SensorTier.PPG) && hasPermission(Manifest.permission.CAMERA)
        if (!allowed || c == null || owner == null) {
            sendEvent(EVENT_CALM, calmErrorMap(
                when {
                    killOn() -> "body signals are switched off"
                    !consented(SensorTier.PPG) -> "calm reading not enabled"
                    !hasPermission(Manifest.permission.CAMERA) -> "camera permission not granted"
                    else -> "no active screen"
                },
            ))
            return false
        }
        // The rear camera cannot run alongside the front-camera face capture.
        stopFace()
        val session = CalmReadingSession(
            c,
            motionEnergy = { motionCapture?.motionEnergy ?: 0.0 },
            onError = { msg ->
                Log.w(TAG, "calm reading camera: $msg")
                stopCalm(emitFinal = false, error = msg)
            },
        )
        calm = session
        calmLive = null
        try {
            session.start(owner)
        } catch (t: Throwable) {
            calm = null
            sendEvent(EVENT_CALM, calmErrorMap(t.message ?: "camera unavailable"))
            updateFace()
            return false
        }
        calmJob = scope.launch {
            while (isActive) {
                delay(1_000L)
                val s = calm ?: break
                val now = System.currentTimeMillis()
                val finished = now - s.startedMs >= CalmReadingSession.DURATION_MS
                val p = s.evaluate(now, finished)
                val liveBpm = p.bpm
                if (liveBpm != null) calmLive = Pair(liveBpm, now)
                if (finished) {
                    val finalBpm = p.bpm
                    if (finalBpm != null) {
                        baselineStore?.setCalibration(finalBpm, p.hrvMs, now)
                    }
                    sendEvent(EVENT_CALM, p.toMap())
                    stopCalm(emitFinal = false)
                    break
                } else {
                    sendEvent(EVENT_CALM, p.toMap())
                }
            }
        }
        return true
    }

    private fun stopCalm(emitFinal: Boolean, error: String? = null) {
        val s = calm ?: return
        calm = null
        val job = calmJob
        calmJob = null
        try {
            s.stop()
        } catch (t: Throwable) {
            // ignore
        }
        if (emitFinal || error != null) {
            sendEvent(EVENT_CALM, calmErrorMap(error ?: "stopped"))
        }
        // Cancel last: this may be called from inside the job itself.
        job?.cancel()
        updateFace()
    }

    private fun calmErrorMap(message: String): Map<String, Any?> = mapOf(
        "bpm" to null,
        "hrv" to null,
        "progress" to 0.0,
        "done" to true,
        "quality" to 0.0,
        "error" to message,
    )

    // MARK: - BLE heart rate

    private fun bleOrCreate(): BleHeartRate? {
        ble?.let { return it }
        val c = ctx ?: return null
        val b = BleHeartRate(
            c,
            onDevice = { id, name, rssi ->
                sendEvent(EVENT_BLE_DEVICE, mapOf("id" to id, "name" to name, "rssi" to rssi))
            },
            onStatus = { status, id, message ->
                sendEvent(EVENT_BLE_STATUS, mapOf("status" to status, "id" to id, "message" to message))
            },
        )
        ble = b
        return b
    }

    private fun scanBle(): Boolean {
        if (killOn() || !consented(SensorTier.BLE)) {
            sendEvent(EVENT_BLE_STATUS, mapOf("status" to "error", "id" to null, "message" to "heart-rate strap not enabled"))
            return false
        }
        return bleOrCreate()?.scan() ?: false
    }

    private fun connectBle(id: String): Boolean {
        if (killOn() || !consented(SensorTier.BLE)) {
            sendEvent(EVENT_BLE_STATUS, mapOf("status" to "error", "id" to id, "message" to "heart-rate strap not enabled"))
            return false
        }
        return bleOrCreate()?.connect(id) ?: false
    }

    // MARK: - Touch

    private fun recordTouchInternal(samples: List<TouchSampleRecord>) {
        if (!consented(SensorTier.TOUCH) || killOn()) return
        synchronized(touchLock) {
            for (s in samples) {
                if (!s.x.isFinite() || !s.y.isFinite() || !s.t.isFinite()) continue
                val phase = when (s.phase.lowercase()) {
                    "start", "down", "began", "touchstart" -> TouchEvent.Phase.BEGAN
                    "end", "up", "ended", "cancel", "touchend", "touchcancel" -> TouchEvent.Phase.ENDED
                    else -> TouchEvent.Phase.MOVED
                }
                val tSec = s.t / 1000.0
                val last = touchEvents.lastOrNull()
                // Clock reset (page reload) or out-of-order: start a fresh window.
                if (last != null && tSec < last.timestamp) touchEvents.clear()
                touchEvents.addLast(
                    TouchEvent(s.x.coerceIn(0.0, 1.0), s.y.coerceIn(0.0, 1.0), tSec, phase),
                )
            }
            val newest = touchEvents.lastOrNull()?.timestamp
            if (newest != null) {
                while (touchEvents.isNotEmpty() && newest - touchEvents.first().timestamp > TOUCH_WINDOW_S) {
                    touchEvents.removeFirst()
                }
            }
            while (touchEvents.size > MAX_TOUCH_EVENTS) touchEvents.removeFirst()
        }
        if (samples.isNotEmpty()) lastTouchWallMs = System.currentTimeMillis()
    }

    // MARK: - Evaluation tick

    /**
     * One 1 s evaluation window: fold every consented signal into its personal
     * baseline, pick the heart-rate source (BLE > calm reading > face rPPG), build the
     * [AffectWindow] and push it through the single [PrivacyGate] exit point.
     */
    private fun tick() {
        val gate = privacyGate ?: return
        val store = baselineStore ?: return
        val now = System.currentTimeMillis()
        tickCount++

        var sourceMask = 0
        var warmup = 0.0
        fun warm(signal: String) {
            warmup = maxOf(warmup, store.warmupFactor(signal, now))
        }

        // Motion.
        val motionOn = consented(SensorTier.MOTION)
        val energy = if (motionOn) motionCapture?.motionEnergy ?: 0.0 else 0.0
        var motionZ: Double? = null
        if (motionOn) {
            store.update("motion", energy, now)
            motionZ = store.z("motion", energy, now)
            if (motionZ != null) warm("motion")
            sourceMask = sourceMask or AffectSource.MOTION
        }
        val still = motionGate.evaluate(energy).passed

        // Face.
        var face: FaceInputs? = null
        var facePresent = false
        val fc = faceCapture
        if (consented(SensorTier.FACE) && fc != null && fc.isRunning) {
            val f = fc.features(now)
            if (f != null && f.framesInWindow >= 10) {
                facePresent = f.facePresentFraction >= 0.5 && now - f.lastFaceMs < 1_500L
                if (facePresent) {
                    store.update("blink", f.blinkRatePerMin, now)
                    store.update("smile", f.smileProb, now)
                }
                val blinkZ = store.z("blink", f.blinkRatePerMin, now)
                val smileZ = store.z("smile", f.smileProb, now)
                if (blinkZ != null) warm("blink")
                if (smileZ != null) warm("smile")
                face = FaceInputs(
                    blinkRateZ = blinkZ,
                    gazeOnScreen = f.gazeOnScreen,
                    smileProb = f.smileProb,
                    smileZ = smileZ,
                    quality = f.facePresentFraction,
                )
                // Gaze/smile carry signal before the baselines warm.
                if (facePresent) {
                    sourceMask = sourceMask or AffectSource.FACE
                    warmup = maxOf(warmup, 0.15)
                }
            }
        }

        // Heart rate: BLE > calm reading (live, then recent) > face rPPG.
        var heart: HeartInputs? = null
        val bleReading = if (consented(SensorTier.BLE)) ble?.latest else null
        val calLive = calmLive
        val calibration = store.calibration()
        if (bleReading != null && now - bleReading.atMs <= 5_000L) {
            store.update("hr", bleReading.bpm, now)
            val rmssd = bleReading.rmssdMs
            if (rmssd != null) store.update("hrv", rmssd, now)
            val hrZ = store.z("hr", bleReading.bpm, now)
            val hrvZ = rmssd?.let { store.z("hrv", it, now) }
            if (hrZ != null) warm("hr")
            heart = HeartInputs(hrZ, hrvZ, 0.95)
            sourceMask = sourceMask or AffectSource.WATCH
        } else if (calm != null && calLive != null && now - calLive.second <= 3_000L) {
            store.update("hr", calLive.first, now)
            val hrZ = store.z("hr", calLive.first, now)
            if (hrZ != null) warm("hr")
            heart = HeartInputs(hrZ, null, 0.85)
            sourceMask = sourceMask or AffectSource.PPG
        } else if (calibration != null && now - calibration.atMs in 0..CALM_RECENT_MS) {
            // Recent calm reading: a snapshot, not a live signal — z only, no baseline update.
            val age = (now - calibration.atMs).toDouble() / CALM_RECENT_MS
            val hrZ = store.z("hr", calibration.bpm, now)
            if (hrZ != null) {
                warm("hr")
                heart = HeartInputs(hrZ, null, (0.8 * (1.0 - age)).coerceAtLeast(0.2))
                sourceMask = sourceMask or AffectSource.PPG
            }
        }
        if (heart == null && facePresent && tickCount % 2L == 0L) {
            val r = rppg.estimate(now, still, facePresent)
            if (r != null) {
                store.learnRppgOffset(r.bpm, now)
                val bpm = r.bpm + store.rppgOffset()
                store.update("hr", bpm, now)
                val hrZ = store.z("hr", bpm, now)
                if (hrZ != null) warm("hr")
                heart = HeartInputs(hrZ, null, 0.5 * r.quality)
                sourceMask = sourceMask or AffectSource.PPG
            }
        }

        // Touch kinematics (only if a batch arrived recently).
        var touch: TouchInputs? = null
        if (consented(SensorTier.TOUCH) && now - lastTouchWallMs <= TOUCH_STALE_MS) {
            val events = synchronized(touchLock) { touchEvents.toList() }
            val tf = touchCapture.features(events)
            if (tf.totalEvents >= 6) {
                val reversalsPer10s = tf.directionReversalCount.toDouble()
                store.update("touch_speed", tf.scrollVelocityMean, now)
                store.update("touch_jitter", tf.scrollVelocityStdDev, now)
                store.update("touch_rev", reversalsPer10s, now)
                val sZ = store.z("touch_speed", tf.scrollVelocityMean, now)
                val jZ = store.z("touch_jitter", tf.scrollVelocityStdDev, now)
                val rZ = store.z("touch_rev", reversalsPer10s, now)
                if (sZ != null || jZ != null || rZ != null) warm("touch_speed")
                touch = TouchInputs(sZ, jZ, rZ, tf.totalEvents)
                sourceMask = sourceMask or AffectSource.TOUCH
            }
        }

        // Motion-gated: DISCARD, never impute. Baselines above were still updated.
        if (!still) return

        // Emit cadence (DP budget is per emit).
        if (tickCount % EMIT_EVERY_TICKS != 0L) return

        val cs = contextCapture?.snapshot(now)
        val contextInputs = cs?.let {
            ContextInputs(proximityNear = it.proximityNear == true, lowLight = it.lowLight, headphones = it.headphones)
        }

        val baselineWarm = motionZ != null || face != null || heart?.hrZ != null ||
            (touch != null && (touch.speedZ != null || touch.jitterZ != null || touch.reversalZ != null))

        val window = AffectWindow(
            windowEndMs = now,
            sourceMask = sourceMask,
            baselineWarm = baselineWarm,
            motionZ = motionZ?.let { doubleArrayOf(it) } ?: DoubleArray(0),
            face = face,
            heart = heart,
            touch = touch,
            context = contextInputs,
        )

        val signal = when {
            heart != null -> SignalKind.HEART_RATE
            face != null -> SignalKind.BLENDSHAPE
            else -> SignalKind.TOUCH
        }
        val impressionId = impressions.impressionFor(now, signal)

        val emitted = gate.produce(window, confidenceScale = warmup, impressionId = impressionId)
        if (emitted != null) {
            lastEmitted = emitted
            sendEvent(EVENT_AFFECT, emitted.toMap())
            Log.d(TAG, "onAffect conf=${emitted.confidence} mask=${emitted.sourceMask}")
        }
    }

    companion object {
        private const val TAG = "VoidSensing"
        private const val TICK_MS = 1_000L
        private const val EMIT_EVERY_TICKS = 2L
        private const val TOUCH_WINDOW_S = 10.0
        private const val TOUCH_STALE_MS = 5_000L
        private const val MAX_TOUCH_EVENTS = 600
        private const val CALM_RECENT_MS = 10L * 60_000L

        const val EVENT_AFFECT = "onAffect"
        const val EVENT_CALM = "onCalmReading"
        const val EVENT_BLE_DEVICE = "onBleDevice"
        const val EVENT_BLE_STATUS = "onBleStatus"
    }
}
