package com.thevoid.sensing.affect

import android.content.Context

/**
 * TFLite-backed affect estimator (production path). Mirrors iOS CoreMLAffectEstimator.
 *
 * Loads a bundled quantized model (`affect_model.tflite`) via the TensorFlow Lite
 * Interpreter. Returns null when:
 *   - the baselines are not warm (cold start), OR
 *   - the model asset is not present (none ships yet — see ml/export), OR
 *   - the real feature-provider / <15ms inference path has not been wired.
 *
 * So callers NEVER receive a fabricated estimate. Until a model asset ships, this
 * ALWAYS returns null — which the JS contract documents as the EXPECTED default.
 *
 * The real model is a 1D-CNN + GRU (~200KB int8, per-user calibration head) trained
 * leave-one-subject-out (random-split accuracy is banned from the model card, T1.8).
 */
class TFLiteAffectEstimator private constructor(
    private val interpreter: Any?,
) : AffectEstimating {

    override fun estimate(window: AffectWindow): AffectStateLocal? {
        // Invariant: no estimate until baselines are warm.
        if (!window.baselineWarm) return null
        // No model bundled yet -> never fabricate output.
        if (interpreter == null) return null
        // Real feature-tensor construction + inference are verified on-device in
        // Android Studio once a model asset ships. Until then we do not fabricate.
        return null
    }

    companion object {
        /** Expected model asset path (relative to the app's assets/). */
        const val MODEL_ASSET = "affect_model.tflite"

        /**
         * Load an estimator. Returns an estimator with a null interpreter (permanent
         * null output) when the model asset is absent or TFLite is unavailable, so the
         * pipeline degrades gracefully to behavioural signals.
         */
        fun load(context: Context, assetName: String = MODEL_ASSET): TFLiteAffectEstimator {
            val interpreter = tryLoadInterpreter(context, assetName)
            return TFLiteAffectEstimator(interpreter)
        }

        /**
         * Attempt to construct a `org.tensorflow.lite.Interpreter` from an asset. Done
         * reflectively so the module compiles and runs even when the (optional) TFLite
         * dependency is not on the classpath, and returns null on any failure.
         */
        private fun tryLoadInterpreter(context: Context, assetName: String): Any? {
            return try {
                // Fail fast (and cheaply) if the asset is not bundled.
                val exists = context.assets.list("")?.contains(assetName) ?: false
                if (!exists) return null

                val fd = context.assets.openFd(assetName)
                fd.createInputStream().channel.use { channel ->
                    val buffer = channel.map(
                        java.nio.channels.FileChannel.MapMode.READ_ONLY,
                        fd.startOffset,
                        fd.declaredLength,
                    )
                    val interpreterClass = Class.forName("org.tensorflow.lite.Interpreter")
                    val ctor = interpreterClass.getConstructor(java.nio.ByteBuffer::class.java)
                    ctor.newInstance(buffer)
                }
            } catch (t: Throwable) {
                null
            }
        }
    }
}
