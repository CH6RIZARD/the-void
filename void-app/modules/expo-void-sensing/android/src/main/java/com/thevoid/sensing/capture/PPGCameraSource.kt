package com.thevoid.sensing.capture

import android.content.Context
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import java.nio.ByteBuffer

/**
 * CameraX + torch source for contact PPG. Binds the rear camera with the torch ON,
 * extracts the mean GREEN intensity over a centre ROI per frame, and pushes that
 * scalar time series to [onGreenSample].
 *
 * INVARIANT #1: the raw green-channel series is device-local. It is consumed only by
 * [PPGCapture] on-device; it NEVER crosses the JS bridge or a network call. This class
 * exposes no getter for the buffer.
 *
 * Requires an Android environment (CameraX). The green-ROI math is isolated in
 * [meanGreen] so it can be verified structurally off-device.
 */
class PPGCameraSource(
    private val context: Context,
    /** ~30fps green ROI-mean sink. Handler runs on the analyzer executor thread. */
    private val onGreenSample: (green: Double, timestampNs: Long) -> Unit,
) {
    private var provider: ProcessCameraProvider? = null
    private var analysis: ImageAnalysis? = null

    /** Bind rear camera + torch to the given lifecycle. No-op on failure (degrade). */
    fun start(lifecycleOwner: LifecycleOwner) {
        val future = ProcessCameraProvider.getInstance(context)
        future.addListener({
            try {
                val cameraProvider = future.get()
                provider = cameraProvider
                val executor = ContextCompat.getMainExecutor(context)
                val imageAnalysis = ImageAnalysis.Builder()
                    .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                    .build()
                imageAnalysis.setAnalyzer(executor) { image ->
                    try {
                        val green = meanGreen(image)
                        onGreenSample(green, image.imageInfo.timestamp)
                    } finally {
                        image.close()
                    }
                }
                analysis = imageAnalysis
                cameraProvider.unbindAll()
                val camera = cameraProvider.bindToLifecycle(
                    lifecycleOwner,
                    CameraSelector.DEFAULT_BACK_CAMERA,
                    imageAnalysis,
                )
                // Torch on: contact PPG needs the LED illuminating the fingertip.
                if (camera.cameraInfo.hasFlashUnit()) {
                    camera.cameraControl.enableTorch(true)
                }
            } catch (t: Throwable) {
                // Camera unavailable / permission denied -> degrade gracefully.
            }
        }, ContextCompat.getMainExecutor(context))
    }

    fun stop() {
        try {
            analysis?.clearAnalyzer()
            provider?.unbindAll()
        } catch (t: Throwable) {
            // ignore
        } finally {
            analysis = null
            provider = null
        }
    }

    companion object {
        /** Fraction of the frame (centred) used as the ROI on each axis. */
        const val ROI_FRACTION = 0.25

        /**
         * Mean green intensity over a centred ROI of a YUV_420_888 frame. The Y (luma)
         * plane approximates perfused-tissue brightness under torch illumination, which
         * is the standard contact-PPG signal. Pure enough to reason about structurally.
         */
        fun meanGreen(image: ImageProxy): Double {
            val plane = image.planes.getOrNull(0) ?: return 0.0
            val buffer: ByteBuffer = plane.buffer
            val rowStride = plane.rowStride
            val pixelStride = plane.pixelStride
            val width = image.width
            val height = image.height
            if (width <= 0 || height <= 0) return 0.0

            val roiW = (width * ROI_FRACTION).toInt().coerceAtLeast(1)
            val roiH = (height * ROI_FRACTION).toInt().coerceAtLeast(1)
            val startX = (width - roiW) / 2
            val startY = (height - roiH) / 2

            var sum = 0.0
            var n = 0
            var y = startY
            while (y < startY + roiH) {
                var x = startX
                while (x < startX + roiW) {
                    val idx = y * rowStride + x * pixelStride
                    if (idx >= 0 && idx < buffer.limit()) {
                        sum += (buffer.get(idx).toInt() and 0xFF).toDouble()
                        n += 1
                    }
                    x += 1
                }
                y += 1
            }
            return if (n == 0) 0.0 else sum / n
        }
    }
}
