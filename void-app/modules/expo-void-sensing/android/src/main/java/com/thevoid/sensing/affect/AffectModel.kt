package com.thevoid.sensing.affect

import android.content.Context

/**
 * Production affect estimator entry point. Mirrors iOS CoreMLAffectEstimator.
 *
 * No trained model ships yet (TensorFlow Lite was removed from the build until one
 * exists), so this delegates to [HeuristicAffectEstimator]. `estimate()` therefore
 * returns real, confidence-capped values as soon as one personal baseline is warm.
 * When a trained model exists, load it here and fall back to the heuristic when the
 * asset is missing.
 */
class TFLiteAffectEstimator private constructor(
    private val fallback: AffectEstimating,
) : AffectEstimating {

    override fun estimate(window: AffectWindow): AffectStateLocal? {
        if (!window.baselineWarm) return null
        return fallback.estimate(window)
    }

    companion object {
        /** Expected model asset path (relative to the app's assets/), for a future model. */
        const val MODEL_ASSET = "affect_model.tflite"

        @Suppress("UNUSED_PARAMETER")
        fun load(context: Context?, assetName: String = MODEL_ASSET): TFLiteAffectEstimator =
            TFLiteAffectEstimator(HeuristicAffectEstimator())
    }
}
