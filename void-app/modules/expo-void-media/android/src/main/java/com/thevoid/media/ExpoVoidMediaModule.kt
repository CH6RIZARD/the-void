package com.thevoid.media

import android.media.MediaCodec
import android.media.MediaFormat
import android.net.Uri
import androidx.annotation.OptIn
import androidx.media3.common.util.UnstableApi
import androidx.media3.common.util.Util
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.cache.CacheDataSource
import androidx.media3.datasource.cache.CacheWriter
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.mediacodec.MediaCodecUtil
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.video.managers.VideoManager
import okhttp3.OkHttpClient
import java.util.concurrent.ConcurrentHashMap

/**
 * The two warm-ups expo-video has no JS surface for (report A.4 #5 and #6).
 *
 * prefetchHead(uri, bytes): a Range request for the first `bytes` of a clip, written
 * into expo-video's OWN SimpleCache (VideoManager.cache.instance) under the default
 * cache key (the uri), so a player later created with useCaching:true reads those bytes
 * from disk and continues upstream from the abort offset. App S2's MDL model.
 *
 * warmCodecs(mimes): populates Media3's decoder-info cache (what every first prepare()
 * pays for) and configures+releases one real decoder so the codec service is up.
 */
@OptIn(UnstableApi::class)
class ExpoVoidMediaModule : Module() {
  private val writers = ConcurrentHashMap<String, CacheWriter>()
  private val client by lazy { OkHttpClient.Builder().build() }

  override fun definition() = ModuleDefinition {
    Name("ExpoVoidMedia")

    // Runs on the module's background queue: CacheWriter.cache() blocks.
    AsyncFunction("prefetchHead") { uri: String, bytes: Double ->
      val context = appContext.reactContext ?: return@AsyncFunction 0.0
      val cache = VideoManager.cache.instance
      val upstream = OkHttpDataSource.Factory(client)
        .setUserAgent(Util.getUserAgent(context, "TheVoid"))
      val source = CacheDataSource.Factory()
        .setCache(cache)
        .setUpstreamDataSourceFactory(upstream)
        .setFlags(CacheDataSource.FLAG_IGNORE_CACHE_ON_ERROR)
        .createDataSource()
      val spec = DataSpec.Builder().setUri(Uri.parse(uri)).setPosition(0).setLength(bytes.toLong()).build()
      var written = 0L
      val writer = CacheWriter(source, spec, null) { _, _, newBytes -> written = newBytes }
      writers[uri] = writer
      try {
        writer.cache()
      } catch (_: Exception) {
        // cancelled, 416 on a file shorter than the head, or network: the player fetches it itself
      } finally {
        writers.remove(uri)
      }
      written.toDouble()
    }

    Function("cancelPrefetch") { uri: String ->
      writers[uri]?.cancel()
    }

    AsyncFunction("warmCodecs") { mimes: List<String> ->
      for (m in mimes) {
        try {
          MediaCodecUtil.warmDecoderInfoCache(m, false, false)
        } catch (_: Exception) {}
      }
      // One real session, released at once: brings up the codec service and the
      // Codec2/OMX plugin for the dominant format (App S3 "-prewarm-itag0").
      val mime = mimes.firstOrNull() ?: "video/avc"
      try {
        val codec = MediaCodec.createDecoderByType(mime)
        codec.configure(MediaFormat.createVideoFormat(mime, 720, 1280), null, null, 0)
        codec.release()
      } catch (_: Exception) {}
    }
  }
}
