package com.example.harbeat

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Color
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import android.view.View
import android.view.ViewGroup
import io.flutter.plugin.common.MethodChannel
import org.json.JSONArray
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.webkit.WebViewAssetLoader
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.Executors

/** Only APK-owned HTML/JS/media are accessible. No remote page or arbitrary URL bridge. */
class RealtimeMixEngine(private val activity: Activity, private val emit: (Map<String, Any?>) -> Unit) {
    private lateinit var web: WebView
    private lateinit var audio: AudioManager
    private var foreground = true
    private var focused = false
    private var focusRequest: AudioFocusRequest? = null
    private val handler = Handler(Looper.getMainLooper())
    private val exports = Executors.newSingleThreadExecutor()
    private val focusListener = AudioManager.OnAudioFocusChangeListener { change ->
        if (change != AudioManager.AUDIOFOCUS_GAIN) {
            focused = false
            pauseEngine()
        }
    }
    private val noisy = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action == AudioManager.ACTION_AUDIO_BECOMING_NOISY) {
                pauseEngine()
                releaseFocus()
            }
        }
    }

    private var ready = false
    private var disposed = false
    private var sequence = 0
    private val pending = mutableMapOf<Int, MethodChannel.Result>()
    private val waiting = mutableListOf<String>()

    init {
        audio = activity.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        activity.volumeControlStream = AudioManager.STREAM_MUSIC
        val loader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(activity)).build()
        web = WebView(activity)
        web.setBackgroundColor(Color.rgb(248, 245, 239))
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = false
            allowFileAccess = false
            allowContentAccess = false
            blockNetworkLoads = true
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            javaScriptCanOpenWindowsAutomatically = false
            setSupportMultipleWindows(false)
            // Playback is gated by the local UI and native foreground/audio focus checks.
            mediaPlaybackRequiresUserGesture = false
        }
        web.webChromeClient = WebChromeClient()
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest) = true
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse {
                val uri = request.url
                if (request.method == "GET" && uri.scheme == "https" && uri.host == "appassets.androidplatform.net" &&
                    uri.path?.matches(Regex("/dance-assets/[a-f0-9]{64}\\.flac")) == true) {
                    return danceAsset(uri.lastPathSegment!!)
                }
                if (request.method == "GET" && uri.scheme == "https" &&
                    uri.host == "appassets.androidplatform.net" &&
                    uri.path?.startsWith("/assets/realtime/") == true) {
                    val response = loader.shouldInterceptRequest(uri)
                    if (response != null) {
                        response.responseHeaders = mapOf(
                            "Content-Security-Policy" to "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; worker-src 'self'; img-src 'self' data:; object-src 'none'; frame-src 'none'; base-uri 'none'",
                            "X-Content-Type-Options" to "nosniff")
                        return response
                    }
                }
                return WebResourceResponse("text/plain", "UTF-8", 403, "Blocked", emptyMap(), ByteArrayInputStream(ByteArray(0)))
            }
            override fun onPageFinished(view: WebView, url: String) {
                if (!foreground) pauseEngine()
            }
        }
        web.addJavascriptInterface(Host(), "HarBeatHost")
        web.addJavascriptInterface(EngineBridge(), "HarBeatEngineHost")
        web.alpha = 0f
        web.isFocusable = false
        web.importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
        activity.findViewById<ViewGroup>(android.R.id.content).addView(web, ViewGroup.LayoutParams(1, 1))
        if (Build.VERSION.SDK_INT >= 33) activity.registerReceiver(noisy, IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY), Context.RECEIVER_NOT_EXPORTED)
        else activity.registerReceiver(noisy, IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY))
        web.loadUrl("https://appassets.androidplatform.net/assets/realtime/engine.html")
    }

    private fun pauseEngine() {
        if (::web.isInitialized) web.evaluateJavascript("window.dispatchEvent(new CustomEvent('harbeat-host',{detail:{active:false}}));", null)
    }
    private fun acquireFocus(): Boolean {
        if (!foreground || activity.isFinishing || disposed) return false
        // An interruption does not resume playback. A new UI gesture reacquires focus.
        web.evaluateJavascript("window.dispatchEvent(new CustomEvent('harbeat-host',{detail:{active:true}}));", null)
        if (focused) return true
        val result = if (Build.VERSION.SDK_INT >= 26) {
            val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build())
                .setOnAudioFocusChangeListener(focusListener).setWillPauseWhenDucked(true).build()
            focusRequest = request
            audio.requestAudioFocus(request)
        } else audio.requestAudioFocus(focusListener, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN)
        focused = result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
        return focused
    }
    private fun releaseFocus() {
        if (Build.VERSION.SDK_INT >= 26) focusRequest?.let { audio.abandonAudioFocusRequest(it) }
        else audio.abandonAudioFocus(focusListener)
        focusRequest = null
        focused = false
    }
    fun resume() {
        foreground = true
        web.evaluateJavascript("window.dispatchEvent(new CustomEvent('harbeat-host',{detail:{active:true}}));", null)
    }
    fun pause() {
        foreground = false
        pauseEngine()
        releaseFocus()
        activity.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }
    fun dispose() {
        if (disposed) return
        disposed = true
        activity.unregisterReceiver(noisy)
        releaseFocus()
        pending.values.forEach { it.error("closed", "实时引擎已关闭", null) }
        pending.clear()
        waiting.clear()
        web.removeJavascriptInterface("HarBeatHost")
        web.removeJavascriptInterface("HarBeatEngineHost")
        (web.parent as? ViewGroup)?.removeView(web)
        web.destroy()
        exports.shutdown()
        activity.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }
    fun command(method: String, args: Map<*, *>, result: MethodChannel.Result) {
        if (disposed || method !in listOf("prepare", "configure", "start", "pause", "resume", "stop", "seek", "request", "cancel", "export")) {
            result.error("unavailable", "不支持的播放器操作", null); return
        }
        val id = ++sequence
        pending[id] = result
        val message = JSONObject().put("id", id).put("method", method).put("args", JSONObject(args)).toString()
        if (ready) send(message) else waiting.add(message)
        handler.postDelayed({
            if (pending.remove(id) != null) {
                waiting.remove(message)
                // Do not leave an unacknowledged start running after the caller times out.
                pauseEngine()
                result.error("timeout", "实时引擎响应超时，请重新开启 V3", null)
            }
        }, if (method == "start") 120000 else 30000)
    }

    /** The WebView can read only content-addressed assets from the owner's NAS relay. */
    @Synchronized private fun danceAsset(name: String): WebResourceResponse {
        try {
            val root = File(activity.cacheDir, "dance-v1").apply { mkdirs() }
            val file = File(root, name)
            if (!file.isFile) {
                val connection = URL("https://8.136.120.255/api/analysis-lab/dance/assets/$name").openConnection() as HttpURLConnection
                connection.connectTimeout = 15000
                connection.readTimeout = 45000
                connection.instanceFollowRedirects = false
                val part = File(root, "$name.part")
                try {
                    check(connection.responseCode == 200) { "NAS audio unavailable" }
                    val digest = MessageDigest.getInstance("SHA-256")
                    connection.inputStream.use { input -> part.outputStream().use { output ->
                        val buffer = ByteArray(65536); var total = 0
                        while (true) {
                            val n = input.read(buffer); if (n < 0) break
                            total += n; check(total <= 64 * 1024 * 1024)
                            digest.update(buffer, 0, n); output.write(buffer, 0, n)
                        }
                    } }
                    check(digest.digest().joinToString("") { "%02x".format(it) } == name.removeSuffix(".flac"))
                    check(part.renameTo(file))
                } finally { connection.disconnect(); part.delete() }
                var size = root.listFiles()?.sumOf { it.length() } ?: 0
                root.listFiles()?.filter { it != file && it.extension == "flac" }?.sortedBy { it.lastModified() }?.forEach {
                    val bytes = it.length()
                    if (size > 600L * 1024 * 1024 && it.delete()) size -= bytes
                }
            }
            file.setLastModified(System.currentTimeMillis())
            return WebResourceResponse("audio/flac", null, file.inputStream())
        } catch (_: Exception) {
            return WebResourceResponse("text/plain", "UTF-8", 503, "Audio unavailable", emptyMap(), ByteArrayInputStream(ByteArray(0)))
        }
    }
    private fun send(message: String) {
        web.evaluateJavascript("window.HarBeatEngine.dispatch($message);", null)
    }
    private fun value(item: Any?): Any? = when (item) {
        JSONObject.NULL -> null
        is JSONObject -> item.keys().asSequence().associateWith { value(item.get(it)) }
        is JSONArray -> (0 until item.length()).map { value(item.get(it)) }
        else -> item
    }
    inner class EngineBridge {
        @JavascriptInterface fun state(text: String) {
            if (text.length > 1000000) return
            val json = runCatching { JSONObject(text) }.getOrNull() ?: return
            handler.post {
                if (disposed) return@post
                if (json.optBoolean("ready") && !ready) {
                    ready = true
                    waiting.toList().forEach { send(it) }; waiting.clear()
                }
                if (foreground && (json.optBoolean("playing") || json.optBoolean("busy"))) activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                else activity.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                @Suppress("UNCHECKED_CAST")
                emit(value(json) as Map<String, Any?>)
            }
        }
        @JavascriptInterface fun reply(id: Int, text: String) {
            val json = runCatching { JSONObject(text) }.getOrNull() ?: return
            handler.post {
                val result = pending.remove(id) ?: return@post
                if (json.optBoolean("ok")) result.success(value(json))
                else result.error("realtime", json.optString("error", "实时操作失败"), null)
            }
        }
    }
    inner class Host {
        @JavascriptInterface fun requestFocus(): Boolean {
            val latch = CountDownLatch(1)
            var granted = false
            handler.post { granted = acquireFocus(); latch.countDown() }
            return latch.await(2, TimeUnit.SECONDS) && granted
        }
        @JavascriptInterface fun close() { handler.post { pause() } }
        @JavascriptInterface fun saveSession(text: String) {
            if (!validSession(text)) return
            if (!exports.isShutdown) exports.execute {
                runCatching {
                    val dir = File(activity.getExternalFilesDir(null), "mix-logs").apply { mkdirs() }
                    val temp = File(dir, "last-session.tmp")
                    temp.writeText(text)
                    temp.renameTo(File(dir, "last-session.json"))
                }
            }
        }
        @JavascriptInterface fun exportLog(text: String, format: String) {
            if (format !in listOf("json", "md") || text.toByteArray().size > 20 * 1024 * 1024) return
            if (format == "json" && !validSession(text)) return
            if (!exports.isShutdown) exports.execute {
                val result = runCatching {
                    val name = "HarBeat-V3-${System.currentTimeMillis()}.$format"
                    if (Build.VERSION.SDK_INT >= 29) {
                        val values = ContentValues().apply {
                            put(MediaStore.Downloads.DISPLAY_NAME, name)
                            put(MediaStore.Downloads.MIME_TYPE, if (format == "json") "application/json" else "text/markdown")
                            put(MediaStore.Downloads.RELATIVE_PATH, "Download/HarBeat")
                            put(MediaStore.Downloads.IS_PENDING, 1)
                        }
                        val uri = activity.contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: error("无法创建文件")
                        try {
                            activity.contentResolver.openOutputStream(uri)?.use { it.write(text.toByteArray()) } ?: error("无法写入文件")
                            activity.contentResolver.update(uri, ContentValues().apply { put(MediaStore.Downloads.IS_PENDING, 0) }, null, null)
                        } catch (e: Exception) { activity.contentResolver.delete(uri, null, null); throw e }
                        "已保存到 下载 / HarBeat"
                    } else {
                        File(activity.getExternalFilesDir(null), "mix-logs").apply { mkdirs() }.resolve(name).writeText(text)
                        "已保存到 App 的 mix-logs 文件夹"
                    }
                }
                handler.post { Toast.makeText(activity, result.getOrElse { "保存失败，请重试" }, Toast.LENGTH_LONG).show() }
            }
        }
        private fun validSession(text: String): Boolean = text.toByteArray().size <= 20 * 1024 * 1024 &&
            runCatching { JSONObject(text).optString("schema") == "harbeat.v3_live_session.v2" }.getOrDefault(false)
    }
}
