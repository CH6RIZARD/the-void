package com.thevoid.sensing.capture

import android.content.Context
import androidx.camera.core.Camera
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import java.nio.ByteBuffer
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * CameraX + torch source for contact (fingertip) PPG — the explicit 30s "calm reading".
 * Binds the rear camera with the torch ON, extracts the mean luma over a centre ROI per
 * frame, and pushes that scalar to [onGreenSample].
 *
 * INVARIANT #1: the raw series is device-local. Frames are processed in memory and
 * closed immediately; nothing is stored. This class exposes no getter for any buffer.
 */
class PPGCameraSource(
    private val context: Context,
    /** ~30fps ROI-mean sink. Runs on the analysis executor thread. */
    private val onGreenSample: (green: Double, timestampMs: Long) -> Unit,
    /** Called on the main thread if the camera could not be bound. */
    private val onError: (message: String) -> Unit = {},
) {
    private var provider: ProcessCameraProvider? = null
    private var analysis: ImageAnalysis? = null
    private var camera: Camera? = null
    private var executor: ExecutorService? = null

    @Volatile
    private var running = false

    /** Bind rear camera + torch to the given lifecycle. No-op on failure (degrade). */
    fun start(lifecycleOwner: LifecycleOwner) {
        if (running) return
        running = true
        val exec = Executors.newSingleThreadExecutor()
        executor = exec
        val future = ProcessCameraProvider.getInstance(context)
        future.addListener({
            try {
                if (!running) return@addListener
                val cameraProvider = future.get()
                provider = cameraProvider
                val imageAnalysis = ImageAnalysis.Builder()
                    .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                    .build()
                imageAnalysis.setAnalyzer(exec) { image ->
                    try {
                        if (running) {
                            val green = meanGreen(image)
                            onGreenSample(green, System.currentTimeMillis())
                        }
                    } finally {
                        image.close()
                    }
                }
                analysis = imageAnalysis
                val cam = cameraProvider.bindToLifecycle(
                    lifecycleOwner,
                    CameraSelector.DEFAULT_BACK_CAMERA,
                    imageAnalysis,
                )
                camera = cam
                // Torch on: contact PPG needs the LED illuminating the fingertip.
                if (cam.cameraInfo.hasFlashUnit()) {
                    cam.cameraControl.enableTorch(true)
                }
            } catch (t: Throwable) {
                // Camera unavailable / permission denied / in use -> degrade gracefully.
                running = false
                onError(t.message ?: "camera unavailable")
            }
        }, ContextCompat.getMainExecutor(context))
    }

    /** Unbind (only this use case) and turn the torch off. Safe from any thread. */
    fun stop() {
        running = false
        val a = analysis
        val p = provider
        val c = camera
        val e = executor
        analysis = null
        provider = null
        camera = null
        executor = null
        ContextCompat.getMainExecutor(context).execute {
            try {
                c?.cameraControl?.enableTorch(false)
            } catch (t: Throwable) {
                // ignore
            }
            try {
                a?.clearAnalyzer()
                if (a != null) p?.unbind(a)
            } catch (t: Throwable) {
                // ignore
            }
            e?.shutdown()
        }
    }

    companion object {
        /** Fraction of the frame (centred) used as the ROI on each axis. */
        const val ROI_FRACTION = 0.25

        /**
         * Mean luma over a centred ROI of a YUV_420_888 frame. Under torch illumination
         * the Y plane tracks perfused-tissue brightness, the standard contact-PPG signal.
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
            val limit = buffer.limit()
            var y = startY
            while (y < startY + roiH) {
                var x = startX
                while (x < startX + roiW) {
                    val idx = y * rowStride + x * pixelStride
                    if (idx in 0 until limit) {
                        sum += (buffer.get(idx).toInt() and 0xFF).toDouble()
                        n += 1
                    }
                    x += 2
                }
                y += 2
            }
            return if (n == 0) 0.0 else sum / n
        }
    }
}
