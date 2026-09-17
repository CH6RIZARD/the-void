package com.thevoid.sensing.capture

import android.content.Context
import android.graphics.Rect
import android.os.BatteryManager
import android.util.Size
import androidx.annotation.OptIn
import androidx.camera.core.CameraSelector
import androidx.camera.core.ExperimentalGetImage
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.face.Face
import com.google.mlkit.vision.face.FaceDetection
import com.google.mlkit.vision.face.FaceDetector
import com.google.mlkit.vision.face.FaceDetectorOptions
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

/** Aggregated face features over the recent past. No frames, no landmarks. */
data class FaceFeatures(
    /** Blinks per minute over the trailing [FaceCapture.BLINK_WINDOW_MS]. */
    val blinkRatePerMin: Double,
    /** Fraction [0,1] of face-present frames (trailing window) looking at the screen. */
    val gazeOnScreen: Double,
    /** Smoothed smile probability [0,1]. */
    val smileProb: Double,
    /** Fraction [0,1] of processed frames (trailing window) with a face. */
    val facePresentFraction: Double,
    /** Wall-clock ms of the last frame that contained a face (0 if none). */
    val lastFaceMs: Long,
    val framesInWindow: Int,
)

/**
 * Front-camera face sensing: CameraX ImageAnalysis (≈640×480, keep-only-latest) →
 * ML Kit face detection (FAST, classification + contours, bundled model).
 *
 * Per processed frame it derives:
 *  - eye-open probability → blink events (both eyes < [EYE_CLOSED_PROB] after being open)
 *  - head Euler angles → looking at the screen (|yaw| < 20° and |pitch| < 20°)
 *  - smile probability
 *  - forehead + cheek ROI mean green (YUV → G) for [RPPGCapture], via [onGreen]
 *
 * Frames are processed in memory and closed immediately — never stored or sent.
 * Runs at ≈10 fps, 5 fps when the battery is below 20%.
 */
class FaceCapture(
    private val context: Context,
    /** (timestampMs, roiMeanGreen) for rPPG; called on the analysis thread. */
    private val onGreen: (timestampMs: Long, green: Double) -> Unit,
    private val onError: (message: String) -> Unit = {},
) {
    private class FrameObs(val tMs: Long, val face: Boolean, val onScreen: Boolean)

    private val lock = Any()
    private val frames = ArrayDeque<FrameObs>()
    private val blinks = ArrayDeque<Long>()
    private var eyesClosed = false
    private var smileEma = 0.0
    private var smileInit = false
    private var lastFaceMs = 0L

    private var provider: ProcessCameraProvider? = null
    private var analysis: ImageAnalysis? = null
    private var executor: ExecutorService? = null
    private var detector: FaceDetector? = null

    @Volatile
    private var running = false

    @Volatile
    private var lastFrameMs = 0L

    @Volatile
    private var frameIntervalMs = FRAME_INTERVAL_MS

    private var lastBatteryCheckMs = 0L

    val isRunning: Boolean get() = running

    /** Bind the front camera to [lifecycleOwner]. Must be given a started lifecycle. */
    fun start(lifecycleOwner: LifecycleOwner) {
        if (running) return
        running = true
        val exec = Executors.newSingleThreadExecutor()
        executor = exec
        val opts = FaceDetectorOptions.Builder()
            .setPerformanceMode(FaceDetectorOptions.PERFORMANCE_MODE_FAST)
            .setClassificationMode(FaceDetectorOptions.CLASSIFICATION_MODE_ALL)
            .setContourMode(FaceDetectorOptions.CONTOUR_MODE_ALL)
            .build()
        val det = FaceDetection.getClient(opts)
        detector = det

        val future = ProcessCameraProvider.getInstance(context)
        future.addListener({
            try {
                if (!running) return@addListener
                val cameraProvider = future.get()
                provider = cameraProvider
                val selector = ResolutionSelector.Builder()
                    .setResolutionStrategy(
                        ResolutionStrategy(
                            Size(640, 480),
                            ResolutionStrategy.FALLBACK_RULE_CLOSEST_HIGHER_THEN_LOWER,
                        ),
                    )
                    .build()
                val imageAnalysis = ImageAnalysis.Builder()
                    .setResolutionSelector(selector)
                    .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                    .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_YUV_420_888)
                    .build()
                imageAnalysis.setAnalyzer(exec) { image -> analyze(image, det, exec) }
                analysis = imageAnalysis
                cameraProvider.bindToLifecycle(
                    lifecycleOwner,
                    CameraSelector.DEFAULT_FRONT_CAMERA,
                    imageAnalysis,
                )
            } catch (t: Throwable) {
                running = false
                onError(t.message ?: "front camera unavailable")
            }
        }, ContextCompat.getMainExecutor(context))
    }

    /** Unbind this use case, release the detector and forget per-session state. */
    fun stop() {
        running = false
        val a = analysis
        val p = provider
        val e = executor
        val d = detector
        analysis = null
        provider = null
        executor = null
        detector = null
        ContextCompat.getMainExecutor(context).execute {
            try {
                a?.clearAnalyzer()
                if (a != null) p?.unbind(a)
            } catch (t: Throwable) {
                // ignore
            }
            try {
                d?.close()
            } catch (t: Throwable) {
                // ignore
            }
            e?.shutdown()
        }
        synchronized(lock) {
            frames.clear()
            blinks.clear()
            eyesClosed = false
            smileInit = false
        }
    }

    /** Aggregated features, or null when no frames were processed recently. */
    fun features(nowMs: Long = System.currentTimeMillis()): FaceFeatures? = synchronized(lock) {
        trim(nowMs)
        if (frames.isEmpty()) {
            null
        } else {
            var faceN = 0
            var onN = 0
            for (f in frames) {
                if (f.face) {
                    faceN++
                    if (f.onScreen) onN++
                }
            }
            val spanMs = max(10_000L, min(BLINK_WINDOW_MS, nowMs - frames.first().tMs))
            val blinkRate = blinks.size * 60_000.0 / spanMs.toDouble()
            FaceFeatures(
                blinkRatePerMin = blinkRate,
                gazeOnScreen = if (faceN > 0) onN.toDouble() / faceN else 0.0,
                smileProb = smileEma,
                facePresentFraction = faceN.toDouble() / frames.size,
                lastFaceMs = lastFaceMs,
                framesInWindow = frames.size,
            )
        }
    }

    private fun trim(nowMs: Long) {
        while (frames.isNotEmpty() && nowMs - frames.first().tMs > GAZE_WINDOW_MS) frames.removeFirst()
        while (blinks.isNotEmpty() && nowMs - blinks.first() > BLINK_WINDOW_MS) blinks.removeFirst()
    }

    @OptIn(markerClass = [ExperimentalGetImage::class])
    private fun analyze(image: ImageProxy, det: FaceDetector, exec: ExecutorService) {
        val now = System.currentTimeMillis()
        if (!running || now - lastFrameMs < frameIntervalMs) {
            image.close()
            return
        }
        lastFrameMs = now
        maybeCheckBattery(now)

        val media = image.image
        if (media == null) {
            image.close()
            return
        }
        val rotation = image.imageInfo.rotationDegrees
        val input = try {
            InputImage.fromMediaImage(media, rotation)
        } catch (t: Throwable) {
            image.close()
            return
        }
        try {
            det.process(input).addOnCompleteListener(exec) { task ->
                try {
                    val faces: List<Face> = if (task.isSuccessful) task.result ?: emptyList() else emptyList()
                    onFaces(faces, image, rotation, now)
                } catch (t: Throwable) {
                    // ignore a bad frame
                } finally {
                    image.close()
                }
            }
        } catch (t: Throwable) {
            // Executor shut down between frames (stop() raced us).
            image.close()
        }
    }

    private fun onFaces(faces: List<Face>, image: ImageProxy, rotation: Int, now: Long) {
        // The most prominent (largest) face is the user.
        var face: Face? = null
        var bestArea = 0
        for (f in faces) {
            val area = f.boundingBox.width() * f.boundingBox.height()
            if (area > bestArea) {
                bestArea = area
                face = f
            }
        }
        if (face == null) {
            synchronized(lock) {
                frames.addLast(FrameObs(now, face = false, onScreen = false))
                trim(now)
            }
            return
        }

        val yaw = face.headEulerAngleY
        val pitch = face.headEulerAngleX
        val onScreen = abs(yaw) < GAZE_MAX_DEG && abs(pitch) < GAZE_MAX_DEG
        val left: Float? = face.leftEyeOpenProbability
        val right: Float? = face.rightEyeOpenProbability
        val smile: Float? = face.smilingProbability

        synchronized(lock) {
            frames.addLast(FrameObs(now, face = true, onScreen = onScreen))
            lastFaceMs = now
            if (left != null && right != null) {
                val open = (left + right) / 2f
                if (!eyesClosed && open < EYE_CLOSED_PROB) {
                    eyesClosed = true
                    blinks.addLast(now)
                } else if (eyesClosed && open >= EYE_REOPEN_PROB) {
                    eyesClosed = false
                }
            }
            if (smile != null) {
                val s = smile.toDouble()
                smileEma = if (smileInit) 0.8 * smileEma + 0.2 * s else s
                smileInit = true
            }
            trim(now)
        }

        // rPPG sample only from a frontal, reasonably sized face.
        if (onScreen && bestArea > MIN_FACE_AREA_PX) {
            val g = roiGreen(image, face.boundingBox, rotation)
            if (g > 0.0) onGreen(now, g)
        }
    }

    private fun maybeCheckBattery(now: Long) {
        if (now - lastBatteryCheckMs < 30_000L) return
        lastBatteryCheckMs = now
        try {
            val bm = context.getSystemService(Context.BATTERY_SERVICE) as? BatteryManager ?: return
            val pct = bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
            frameIntervalMs = if (pct in 1 until LOW_BATTERY_PCT) LOW_BATTERY_FRAME_INTERVAL_MS else FRAME_INTERVAL_MS
        } catch (t: Throwable) {
            // ignore
        }
    }

    companion object {
        const val FRAME_INTERVAL_MS = 100L           // ≈10 fps
        const val LOW_BATTERY_FRAME_INTERVAL_MS = 200L // ≈5 fps
        const val LOW_BATTERY_PCT = 20
        const val EYE_CLOSED_PROB = 0.3f
        const val EYE_REOPEN_PROB = 0.5f
        const val GAZE_MAX_DEG = 20f
        const val GAZE_WINDOW_MS = 10_000L
        const val BLINK_WINDOW_MS = 60_000L
        const val MIN_FACE_AREA_PX = 90 * 90

        /**
         * Mean approximate GREEN over forehead + both cheeks.
         *
         * ML Kit returns the bounding box in the UPRIGHT (rotated) image space; the YUV
         * planes are in sensor orientation, so each ROI is mapped back through
         * [rotation] before sampling. G ≈ Y − 0.344·(U−128) − 0.714·(V−128) (BT.601).
         * Sampled on a 2-px grid; nothing is copied or retained.
         */
        fun roiGreen(image: ImageProxy, box: Rect, rotation: Int): Double {
            val planes = image.planes
            if (planes.size < 3) return 0.0
            val w = image.width
            val h = image.height
            if (w <= 0 || h <= 0) return 0.0
            val uprightW = if (rotation == 90 || rotation == 270) h else w
            val uprightH = if (rotation == 90 || rotation == 270) w else h

            val bw = box.width().toDouble()
            val bh = box.height().toDouble()
            // (x0, y0, x1, y1) fractions of the face box, upright space.
            val rois = arrayOf(
                doubleArrayOf(0.30, 0.08, 0.70, 0.22), // forehead
                doubleArrayOf(0.15, 0.50, 0.35, 0.68), // cheek
                doubleArrayOf(0.65, 0.50, 0.85, 0.68), // other cheek
            )

            val yPlane = planes[0]
            val uPlane = planes[1]
            val vPlane = planes[2]
            val yBuf = yPlane.buffer
            val uBuf = uPlane.buffer
            val vBuf = vPlane.buffer
            val yLimit = yBuf.limit()
            val uLimit = uBuf.limit()
            val vLimit = vBuf.limit()

            var sum = 0.0
            var n = 0
            for (r in rois) {
                val ux0 = (box.left + r[0] * bw).toInt().coerceIn(0, uprightW - 1)
                val uy0 = (box.top + r[1] * bh).toInt().coerceIn(0, uprightH - 1)
                val ux1 = (box.left + r[2] * bw).toInt().coerceIn(0, uprightW - 1)
                val uy1 = (box.top + r[3] * bh).toInt().coerceIn(0, uprightH - 1)
                val a = toSensor(ux0, uy0, rotation, w, h)
                val b = toSensor(ux1, uy1, rotation, w, h)
                val sx0 = min(a[0], b[0]).coerceIn(0, w - 1)
                val sx1 = max(a[0], b[0]).coerceIn(0, w - 1)
                val sy0 = min(a[1], b[1]).coerceIn(0, h - 1)
                val sy1 = max(a[1], b[1]).coerceIn(0, h - 1)
                var y = sy0
                while (y <= sy1) {
                    var x = sx0
                    while (x <= sx1) {
                        val yi = y * yPlane.rowStride + x * yPlane.pixelStride
                        val ui = (y / 2) * uPlane.rowStride + (x / 2) * uPlane.pixelStride
                        val vi = (y / 2) * vPlane.rowStride + (x / 2) * vPlane.pixelStride
                        if (yi in 0 until yLimit && ui in 0 until uLimit && vi in 0 until vLimit) {
                            val yy = (yBuf.get(yi).toInt() and 0xFF).toDouble()
                            val uu = (uBuf.get(ui).toInt() and 0xFF).toDouble() - 128.0
                            val vv = (vBuf.get(vi).toInt() and 0xFF).toDouble() - 128.0
                            val g = yy - 0.344 * uu - 0.714 * vv
                            sum += g.coerceIn(0.0, 255.0)
                            n++
                        }
                        x += 2
                    }
                    y += 2
                }
            }
            return if (n == 0) 0.0 else sum / n
        }

        /** Map an upright-space point back to sensor (plane) coordinates. */
        private fun toSensor(u: Int, v: Int, rotation: Int, w: Int, h: Int): IntArray = when (rotation) {
            90 -> intArrayOf(v, h - 1 - u)
            180 -> intArrayOf(w - 1 - u, h - 1 - v)
            270 -> intArrayOf(w - 1 - v, u)
            else -> intArrayOf(u, v)
        }
    }
}
