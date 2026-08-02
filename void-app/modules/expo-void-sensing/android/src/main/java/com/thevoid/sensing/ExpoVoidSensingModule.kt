package com.thevoid.sensing

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorManager
import com.thevoid.sensing.affect.AffectEstimating
import com.thevoid.sensing.affect.AffectWindow
import com.thevoid.sensing.affect.TFLiteAffectEstimator
import com.thevoid.sensing.capture.HealthBridge
import com.thevoid.sensing.capture.MotionCapture
import com.thevoid.sensing.capture.PPGCapture
import com.thevoid.sensing.capture.TouchCapture
import com.thevoid.sensing.pipeline.Attribution
import com.thevoid.sensing.pipeline.BaselineStore
import com.thevoid.sensing.pipeline.MotionGate
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
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.util.concurrent.ConcurrentHashMap

// MARK: - Record types (JS bridge shapes; must match index.ts field names exactly)

/** Mirrors index.ts `ConsentState`. */
class ConsentStateRecord : Record {
    @Field var affectConsent: Boolean = false
    @Field var perTier: Map<String, Boolean> = emptyMap()
    @Field var nonBiometricFeed: Boolean = true
}

/** Mirrors index.ts `AffectState` (the quantized, DP-noised wire shape). */
class AffectStateRecord : Record {
    @Field var valenceZ: Int = 0
    @Field var arousalZ: Int = 0
    @Field var attentionZ: Int = 0
    @Field var confidence: Int = 0
    @Field var sourceMask: Int = 0
    @Field var windowEndMs: Double = 0.0
    @Field var dpApplied: Boolean = false
}

/**
 * expo-void-sensing (Android). The ONLY bridge between the on-device sensing/affect
 * pipeline and JS. Per void-rank invariant #1, raw physiological data (IMU, PPG frames,
 * green-channel series, HR/HRV) NEVER crosses this boundary — the module emits only the
 * quantized [EmittedAffectState]. There is no method that returns a raw buffer.
 */
class ExpoVoidSensingModule : Module() {

    // Sensing stack (nullable until OnCreate wires a Context).
    private var motionCapture: MotionCapture? = null
    private val touchCapture = TouchCapture()
    private val ppgCapture = PPGCapture()
    private var healthBridge: HealthBridge? = null

    private var baselineStore: BaselineStore? = null
    private val motionGate = MotionGate()
    private val attribution = Attribution()

    private var consentManager: ConsentManager? = null
    private var killSwitch: KillSwitch? = null
    private var privacyGate: PrivacyGate? = null

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private var loopJob: Job? = null

    @Volatile
    private var lastEmitted: EmittedAffectState? = null

    /** impressionId -> (itemId, markedAtMs) for Attribution lag alignment. */
    private val impressions = ConcurrentHashMap<String, Pair<String, Long>>()

    private val contextOrNull: Context?
        get() = appContext.reactContext

    override fun definition() = ModuleDefinition {
        Name("ExpoVoidSensing")

        Events("onAffect")

        OnCreate {
            val ctx = contextOrNull
            motionCapture = MotionCapture(ctx)
            healthBridge = ctx?.let { HealthBridge(it) }
            baselineStore = BaselineStore(ctx)
            consentManager = ConsentManager(ctx)
            killSwitch = KillSwitch(ctx)
            // With a Context, try to load the (optional) TFLite model; it returns null
            // output until a model asset actually ships. Without a Context (degenerate
            // test path), use an estimator that never fabricates output.
            val estimator: AffectEstimating = ctx?.let { TFLiteAffectEstimator.load(it) }
                ?: object : AffectEstimating {
                    override fun estimate(window: AffectWindow) = null
                }
            val cm = consentManager!!
            val ks = killSwitch!!
            privacyGate = PrivacyGate(cm, ks, estimator, DPMechanism())
        }

        OnDestroy {
            stopInternal()
            loopJob?.cancel()
        }

        Function("isAvailable") {
            isAvailableInternal()
        }

        AsyncFunction("requestConsent") { tiers: List<String> ->
            val cm = consentManager ?: return@AsyncFunction ConsentStateRecord()
            val parsed = tiers.mapNotNull { SensorTier.fromJs(it) }
            consentToRecord(cm.grant(parsed))
        }

        Function("getConsent") {
            val cm = consentManager
            if (cm == null) ConsentStateRecord() else consentToRecord(cm.snapshot())
        }

        Function("setKillSwitch") { enabled: Boolean ->
            killSwitch?.set(enabled)
            if (!enabled) stopInternal()
        }

        AsyncFunction("start") {
            startInternal()
        }

        AsyncFunction("stop") {
            stopInternal()
        }

        Function("getAffectState") {
            lastEmitted?.let { emittedToRecord(it) }
        }

        Function("markImpression") { impressionId: String, itemId: String ->
            impressions[impressionId] = itemId to System.currentTimeMillis()
        }
    }

    // MARK: - Lifecycle

    private fun isAvailableInternal(): Boolean {
        val ctx = contextOrNull ?: return false
        val sm = ctx.getSystemService(Context.SENSOR_SERVICE) as? SensorManager ?: return false
        val hasAccel = sm.getDefaultSensor(Sensor.TYPE_LINEAR_ACCELERATION) != null ||
            sm.getDefaultSensor(Sensor.TYPE_ACCELEROMETER) != null
        return hasAccel
    }

    private fun startInternal() {
        val ks = killSwitch ?: return
        if (!ks.isEnabled()) return
        val consent = consentManager?.snapshot() ?: return
        // Start only consented, non-content Tier-0 capture here; PPG (camera) and Health
        // reads require a LifecycleOwner / permission flow driven by the app layer.
        if (consent.perTier[SensorTier.MOTION] == true) {
            motionCapture?.start()
        }
        if (loopJob?.isActive != true) {
            loopJob = scope.launch {
                while (isActive) {
                    tick()
                    delay(TICK_MS)
                }
            }
        }
    }

    private fun stopInternal() {
        motionCapture?.stop()
        loopJob?.cancel()
        loopJob = null
    }

    /**
     * One evaluation window. Builds a baseline-normalized [AffectWindow] and pushes it
     * through the single [PrivacyGate] exit point. In practice this yields null (no
     * model ships and baselines take >=3 days to warm) — the JS contract documents null
     * as the EXPECTED default. RAW sensor values never leave this method.
     */
    private suspend fun tick() {
        val gate = privacyGate ?: return
        val store = baselineStore ?: return
        val now = System.currentTimeMillis()

        var sourceMask = 0

        // Motion energy (Tier 0). Fold into baseline, then gate on it.
        val energy = motionCapture?.motionEnergy ?: 0.0
        store.update("motion", energy, now)
        sourceMask = sourceMask or AffectSource.MOTION

        val gateResult = motionGate.evaluate(energy)
        if (!gateResult.passed) {
            // Motion-gated: DISCARD, never impute (CLAUDE.md #5). No emit.
            return
        }

        // Optional wearable HR/HRV (Tier 1, Health Connect).
        var hrZ: DoubleArray = DoubleArray(0)
        var hrvZ: DoubleArray = DoubleArray(0)
        val watch = try {
            healthBridge?.readLatest()
        } catch (t: Throwable) {
            null
        }
        if (watch != null) {
            sourceMask = sourceMask or AffectSource.WATCH
            watch.heartRateBpm?.let { hr ->
                store.update("hr", hr, now)
                store.z("hr", hr, now)?.let { hrZ = doubleArrayOf(it) }
            }
            watch.hrvMs?.let { hrv ->
                store.update("hrv", hrv, now)
                store.z("hrv", hrv, now)?.let { hrvZ = doubleArrayOf(it) }
            }
        }

        val motionZ = store.z("motion", energy, now)
        // Warm only when at least one contributing baseline is warm.
        val warm = motionZ != null || hrZ.isNotEmpty() || hrvZ.isNotEmpty()

        val window = AffectWindow(
            windowEndMs = now,
            sourceMask = sourceMask,
            baselineWarm = warm,
            hrZ = hrZ,
            hrvZ = hrvZ,
            motionZ = motionZ?.let { doubleArrayOf(it) } ?: DoubleArray(0),
        )

        val emitted = gate.produce(window)
        if (emitted != null) {
            lastEmitted = emitted
            sendEvent("onAffect", emitted.toMap())
        }
    }

    // MARK: - Record conversion

    private fun consentToRecord(snapshot: ConsentSnapshot): ConsentStateRecord {
        val record = ConsentStateRecord()
        record.affectConsent = snapshot.affectConsent
        record.perTier = SensorTier.values().associate { it.jsKey to (snapshot.perTier[it] ?: false) }
        record.nonBiometricFeed = snapshot.nonBiometricFeed
        return record
    }

    private fun emittedToRecord(e: EmittedAffectState): AffectStateRecord {
        val record = AffectStateRecord()
        record.valenceZ = e.valenceZ
        record.arousalZ = e.arousalZ
        record.attentionZ = e.attentionZ
        record.confidence = e.confidence
        record.sourceMask = e.sourceMask
        record.windowEndMs = e.windowEndMs.toDouble()
        record.dpApplied = e.dpApplied
        return record
    }

    companion object {
        private const val TICK_MS = 1_000L
    }
}
