package com.example.harbeat

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
import io.flutter.plugin.common.MethodChannel
import org.json.JSONArray
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
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
import java.io.ByteArrayOutputStream
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.Executors
import java.util.concurrent.Semaphore

/** Only APK-owned HTML/JS/media are accessible. No remote page or arbitrary URL bridge. */
class RealtimeMixEngine(
    private val context: Context,
    private val startPlayback: () -> Boolean,
    private val emit: (Map<String, Any?>) -> Unit
) {
    private val isLongmixLab = context.packageName == "com.example.harbeat.longmixlab"
    private lateinit var web: WebView
    private lateinit var audio: AudioManager
    private var focused = false
    private var focusRequest: AudioFocusRequest? = null
    private val handler = Handler(Looper.getMainLooper())
    private val exports = Executors.newSingleThreadExecutor()
    private val metricRequests = Executors.newSingleThreadExecutor()
    private val metricSlot = Semaphore(1)
    private val audioLoads = AudioLoadCoordinator()
    private val audioCacheMaintenance = Any()
    private val focusListener = AudioManager.OnAudioFocusChangeListener { change ->
        if (change != AudioManager.AUDIOFOCUS_GAIN) {
            pauseEngine("audio-focus:$change")
            releaseFocus()
        }
    }
    private val noisy = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action == AudioManager.ACTION_AUDIO_BECOMING_NOISY) {
                pauseEngine("headphones-disconnected")
                releaseFocus()
            }
        }
    }

    private var lastPlaybackLog = 0L
    private var ready = false
    @Volatile private var publicOrigin = ""
    private var engineMode = "v3"
    private var disposed = false
    private var sequence = 0
    private val pending = mutableMapOf<Int, MethodChannel.Result>()
    private val waiting = mutableListOf<String>()

    init {
        audio = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        val loader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(context)).build()
        web = WebView(context)
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
                val preparation = request.requestHeaders.entries.any { it.key.equals("X-HarBeat-Audio-Purpose", true) && it.value == "prepare" }
                if (request.method == "GET" && uri.scheme == "https" && uri.host == "appassets.androidplatform.net" &&
                    uri.path?.matches(Regex("/dance-assets/[a-f0-9]{64}\\.flac")) == true) {
                    return danceAsset(uri.lastPathSegment!!, preparation)
                }
                if (request.method == "GET" && uri.scheme == "https" && uri.host == "appassets.androidplatform.net") {
                    val path = uri.encodedPath ?: ""
                    val hash = uri.getQueryParameter("sha256") ?: ""
                    if (isLongmixLab && hash.matches(Regex("[a-f0-9]{64}")) && path == "/listen/media/$hash.flac") {
                        val packed = runCatching { context.assets.open("realtime/pair-reference-lab/media/$hash.flac") }.getOrNull()
                        if (packed != null) return WebResourceResponse("audio/flac", null, packed)
                        val directory = context.getExternalFilesDir(null)
                        if (directory != null) {
                            val local = File(directory, "dj-set/media/$hash.flac")
                            val stream = runCatching { local.inputStream() }.getOrNull()
                            if (stream != null) return WebResourceResponse("audio/flac", null, stream)
                        }
                    }
                    if (path == "/listen/dj-pair-references/v1/index.json") return continuousMetadata(path, 256 * 1024)
                    if (path == "/listen/transition-policy/v1/index.json") return continuousMetadata(path, 512 * 1024)
                    if (path == "/listen/catalog/bassment-fm-v1/library.json") return continuousMetadata(path)
                    val executionAudio = Regex("/listen/execution-media/([a-f0-9]{64})\\.(flac|wav)").matchEntire(path)
                    if (executionAudio != null && hash == executionAudio.groupValues[1]) return verifiedAudio(path, hash, preparation)
                    if (path.matches(Regex("/listen/(?:catalog/[A-Za-z0-9_-]{1,160}/)?media/[A-Za-z0-9_.-]+\\.(flac|wav)")) && hash.matches(Regex("[a-f0-9]{64}"))) return verifiedAudio(path, hash, preparation)
                    if (path.matches(Regex("/listen/smart-media/[a-f0-9]{64}/(original|bass|filter|yield|vocal|bass_filter)\\.wav")) && hash.matches(Regex("[a-f0-9]{64}"))) return verifiedAudio(path, hash, preparation)
                    if (path.matches(Regex("/listen/(library\\.json|(?:catalog/[A-Za-z0-9_-]{1,160}/)?details/[A-Za-z0-9_-]{1,160}\\.json|smart-api/(jobs|plans)/[a-f0-9]{64})"))) return continuousMetadata(path)
                    if (path.matches(Regex("/listen/longmix-lab/v1/(index\\.json|[a-f0-9]{64}\\.json)"))) return continuousMetadata(path, 2 * 1024 * 1024)
                    if (path.matches(Regex("/listen/longmix-live/v1/(index\\.json|[a-f0-9]{64}\\.json)"))) return continuousMetadata(path, 2 * 1024 * 1024)
                    if (isLongmixLab && path.matches(Regex("/listen/multi-layering/v1/(index\\.json|[a-f0-9]{64}\\.json)"))) return continuousMetadata(path, 2 * 1024 * 1024)
                    if (isLongmixLab && path.matches(Regex("/listen/role-replacement/v1/(index\\.json|[a-f0-9]{64}\\.json)"))) return continuousMetadata(path, 2 * 1024 * 1024)
                    if (isLongmixLab && path.matches(Regex("/listen/longmix-return/v1/(index\\.json|[a-f0-9]{64}\\.json)"))) return continuousMetadata(path, 2 * 1024 * 1024)
                    if (isLongmixLab && path.matches(Regex("/listen/loop-extension/v1/(index\\.json|[a-f0-9]{64}\\.json)"))) return continuousMetadata(path, 2 * 1024 * 1024)

                    if (path.matches(Regex("/listen/execution/(index\\.json|tracks/track-[a-f0-9]{20}\\.json|profiles/[a-f0-9]{64}\\.json)"))) return continuousMetadata(path)
                    if (path.matches(Regex("/listen/crossgenre/(index\\.json|objects/[a-f0-9]{64}\\.json)"))) return continuousMetadata(path, if (path.endsWith("/index.json")) 4 * 1024 * 1024 else 512 * 1024)
                    if (path.matches(Regex("/analysis-lab-static/mobile-library-v1/(library\\.json|catalog/[A-Za-z0-9_-]{1,160}/details/track-[a-f0-9]{20}\\.json)"))) return continuousMetadata(path)
                    val publishedAudio = path.matches(Regex("/analysis-lab-static/(v3-live-baseline-20260922|v31-candidate-20260923|vocal-overlap-corpus-20260924)/media/[A-Za-z0-9_.-]+\\.flac"))
                    val registeredAudio = path.matches(Regex("/api/analysis-lab/media/[a-f0-9]{64}"))
                    if ((publishedAudio || registeredAudio) && hash.matches(Regex("[a-f0-9]{64}"))) {
                        return verifiedAudio(path, hash, preparation)
                    }
                    if (path.matches(Regex("/analysis-lab-static/continuous-live-20260924/(library\\.json|details/track-[a-f0-9]{20}\\.json(\\.gz)?)"))) {
                        return continuousMetadata(path)
                    }
                }
                if (request.method == "GET" && uri.scheme == "https" &&
                    uri.host == "appassets.androidplatform.net" &&
                    uri.path?.startsWith("/assets/realtime/") == true) {
                    val response = loader.shouldInterceptRequest(uri)
                    if (response != null) {
                        response.responseHeaders = mapOf(
                            "Content-Security-Policy" to "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self' blob:; worker-src 'self'; img-src 'self' data:; object-src 'none'; frame-src 'none'; base-uri 'none'",
                            "X-Content-Type-Options" to "nosniff")
                        return response
                    }
                }
                return WebResourceResponse("text/plain", "UTF-8", 403, "Blocked", emptyMap(), ByteArrayInputStream(ByteArray(0)))
            }
        }
        web.addJavascriptInterface(Host(), "HarBeatHost")
        web.addJavascriptInterface(EngineBridge(), "HarBeatEngineHost")
        web.alpha = 0f
        web.isFocusable = false
        web.importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
        if (Build.VERSION.SDK_INT >= 33) context.registerReceiver(noisy, IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY), Context.RECEIVER_NOT_EXPORTED)
        else context.registerReceiver(noisy, IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY))
        web.loadUrl("https://appassets.androidplatform.net/assets/realtime/engine.html")
    }

    private fun pauseEngine(reason: String) {
        android.util.Log.i("HarBeatPlayback", "pause:$reason")
        if (::web.isInitialized) web.evaluateJavascript("window.dispatchEvent(new CustomEvent('harbeat-host',{detail:{active:false,reason:${JSONObject.quote(reason)}}}));", null)
    }
    private fun acquireFocus(): Boolean {
        if (disposed || !startPlayback()) return false
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
    fun releaseFocus() {
        if (Build.VERSION.SDK_INT >= 26) focusRequest?.let { audio.abandonAudioFocusRequest(it) }
        else audio.abandonAudioFocus(focusListener)
        focusRequest = null
        focused = false
    }
    fun resume() {
        web.evaluateJavascript("window.dispatchEvent(new CustomEvent('harbeat-host',{detail:{active:true}}));", null)
    }
    fun pause() {
        pauseEngine("activity-background")
        releaseFocus()
    }
    fun dispose() {
        if (disposed) return
        disposed = true
        context.unregisterReceiver(noisy)
        releaseFocus()
        pending.values.forEach { it.error("closed", "实时引擎已关闭", null) }
        pending.clear()
        waiting.clear()
        web.removeJavascriptInterface("HarBeatHost")
        web.removeJavascriptInterface("HarBeatEngineHost")
        web.destroy()
        exports.shutdown()
        metricRequests.shutdown()
    }
    fun command(method: String, args: Map<*, *>, result: MethodChannel.Result) {
        if (disposed || method !in listOf("prepare", "loadScene", "exit", "configure", "start", "startToucanSet", "toucanAuditions", "pause", "resume", "stop", "seek", "request", "cancel", "export", "select", "volume", "automatic", "filters", "metricPrepare", "mixSoon", "metricMethod", "metricApply", "direction", "experimentalTransitions", "recommend", "setSession", "clearSet", "cacheSet", "prepareAutoSet", "autoPreparation", "refreshLibrary", "mcMode", "scratch", "continuousSet", "loopExtension", "liveLayering", "multiLayering", "djPlay", "djPause", "djResume", "djStop", "djClose", "djSnapshot")) {
            result.error("unavailable", "不支持的播放器操作", null); return
        }
        if (method in listOf("continuousSet", "loopExtension") && !isLongmixLab) {
            result.error("unavailable", "连续演出仅在独立试验包启用", null); return
        }
        if (method == "multiLayering" && !isLongmixLab) {
            result.error("unavailable", "多来源编排仅在独立试验包中启用", null); return
        }
        if (method == "liveLayering" && !isLongmixLab &&
            args["outcome"] != null && args["outcome"] != "takeover-b") {
            result.error("unavailable", "此长混结局仅在独立试验包中启用", null); return
        }
        if ((method.startsWith("dj") || (method == "prepare" && args["mode"] == "dj-reference")) && !isLongmixLab) {
            result.error("unavailable", "DJ 对照仅在独立试验包启用", null); return
        }
        if (method in listOf("startToucanSet", "toucanAuditions") && (!isLongmixLab || engineMode != "metric")) {
            result.error("unavailable", "Toucan Set 仅在手机混音试验版启用", null); return
        }
        if (method == "prepare") {
            val configured = runCatching { java.net.URI(args["publicOrigin"] as String) }.getOrNull()
            if (configured == null || configured.scheme != "https" || configured.host.isNullOrBlank() ||
                configured.rawUserInfo != null || configured.rawQuery != null || configured.rawFragment != null ||
                configured.rawPath !in listOf("", "/") ||
                (publicOrigin.isNotEmpty() && publicOrigin != configured.toString().trimEnd('/'))) {
                result.error("origin", "混音服务地址无效或已改变，请重新启动 App", null); return
            }
            publicOrigin = configured.toString().trimEnd('/')
            val nextMode = when (args["mode"]) { "metric", "dj-reference" -> "metric"; "longmix" -> "longmix"; else -> "v3" }
            if (nextMode != engineMode) {
                pauseEngine("engine-mode-change"); ready = false; engineMode = nextMode
                val page = when (nextMode) {
                    "metric" -> "metric-engine.html"
                    "longmix" -> "longmix.html"
                    else -> "engine.html"
                }
                web.loadUrl("https://appassets.androidplatform.net/assets/realtime/$page")
            }
        }
        val id = ++sequence
        pending[id] = result
        val message = JSONObject().put("id", id).put("method", method).put("args", JSONObject(args)).toString()
        if (ready) send(message) else waiting.add(message)
        handler.postDelayed({
            if (pending.remove(id) != null) {
                waiting.remove(message)
                // Do not leave an unacknowledged start running after the caller times out.
                pauseEngine("command-timeout:$method")
                result.error("timeout", "实时引擎响应超时，请重新开启 V3", null)
            }
        }, if (method in listOf("loadScene", "metricPrepare", "mixSoon")) 420000 else if (method in listOf("start", "metricApply", "djPlay")) 180000 else 30000)
    }

    /** The WebView can read only content-addressed assets from the owner's NAS relay. */
    private fun danceAsset(name: String, preparation: Boolean) = verifiedAudio("/api/analysis-lab/dance/assets/$name", name.removeSuffix(".flac"), preparation)

    private fun executionOrigin(path: String): String {
        val enabled = isLongmixLab && context.getExternalFilesDir(null)?.let {
            File(it, "dj-set/stem-retest.usb").isFile
        } == true
        return ExecutionTrialRouting.origin(enabled, publicOrigin, path)
    }

    private fun openAudioGet(path: String, connectMs: Int, readMs: Int): HttpURLConnection {
        fun open(origin: String, connect: Int) = (URL("$origin$path").openConnection() as HttpURLConnection).apply {
            connectTimeout = connect
            readTimeout = readMs
            instanceFollowRedirects = false
        }
        val origin = executionOrigin(path)
        if (origin != publicOrigin) {
            val trial = open(origin, 1500)
            if (runCatching { trial.responseCode == 200 }.getOrDefault(false)) return trial
            trial.disconnect()
        }
        return open(publicOrigin, connectMs)
    }

    private fun continuousMetadata(path: String, maxBytes: Int = 16 * 1024 * 1024): WebResourceResponse {
        val connection = openAudioGet(path, 10000, 20000)
        return try {
            if (connection.responseCode != 200) {
                WebResourceResponse("text/plain", "UTF-8", 404, "Unavailable", emptyMap(), ByteArrayInputStream(ByteArray(0)))
            } else {
                val bytes = ByteArrayOutputStream()
                connection.inputStream.use { input ->
                    val buffer = ByteArray(65536)
                    while (true) {
                        val n = input.read(buffer); if (n < 0) break
                        check(bytes.size() + n <= maxBytes)
                        bytes.write(buffer, 0, n)
                    }
                }
                WebResourceResponse(if (path.endsWith(".gz")) "application/gzip" else "application/json", null,
                    200, "OK", mapOf("X-Content-Type-Options" to "nosniff"), ByteArrayInputStream(bytes.toByteArray()))
            }
        } catch (_: Exception) {
            WebResourceResponse("text/plain", "UTF-8", 503, "Unavailable", emptyMap(), ByteArrayInputStream(ByteArray(0)))
        } finally { connection.disconnect() }
    }

    private fun verifiedAudio(path: String, hash: String, preparation: Boolean): WebResourceResponse {
        return try { audioLoads.withAsset(hash) {
            val root = File(context.cacheDir, "dance-v1").apply { mkdirs() }
            val name = "$hash.flac"
            val file = File(root, name)
            val mime = if (path.endsWith(".wav")) "audio/wav" else "audio/flac"
            // File lookup/open and eviction share only this short local lock.
            // A slow NAS download must not hold it or block cached playback.
            val hit = synchronized(audioCacheMaintenance) {
                if (file.isFile) { file.setLastModified(System.currentTimeMillis()); file.inputStream() } else null
            }
            if (hit != null) return@withAsset WebResourceResponse(mime, null, hit)
            val queuedAt = android.os.SystemClock.elapsedRealtime()
            val purpose = if (preparation) "prepare" else "playback"
            audioLoads.withDownload(preparation) {
                val beganAt = android.os.SystemClock.elapsedRealtime()
                android.util.Log.i("HarBeatAudio", "download_start hash=$hash role=$purpose waitMs=${beganAt - queuedAt}")
                val connection = openAudioGet(path, 15000, 45000)
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
                    synchronized(audioCacheMaintenance) { check(part.renameTo(file)) }
                } finally {
                    connection.disconnect(); part.delete()
                    android.util.Log.i("HarBeatAudio", "download_end hash=$hash role=$purpose elapsedMs=${android.os.SystemClock.elapsedRealtime() - beganAt} verified=${file.isFile} bytes=${file.length()}")
                }
            }
            val stream = synchronized(audioCacheMaintenance) {
                val active = audioLoads.activeKeys()
                var size = root.listFiles()?.sumOf { it.length() } ?: 0
                root.listFiles()?.filter { it != file && it.extension == "flac" && it.nameWithoutExtension !in active }?.sortedBy { it.lastModified() }?.forEach {
                    val bytes = it.length()
                    if (size > 600L * 1024 * 1024 && it.delete()) size -= bytes
                }
                file.setLastModified(System.currentTimeMillis())
                file.inputStream()
            }
            WebResourceResponse(mime, null, stream)
        }
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
                if ((engineMode == "longmix") != (json.optString("mode") == "longmix")) return@post
                if ((engineMode == "metric") != (json.optJSONObject("metric") != null)) return@post
                if (json.optBoolean("ready") && !ready) {
                    ready = true
                    waiting.toList().forEach { send(it) }; waiting.clear()
                }
                val now = android.os.SystemClock.elapsedRealtime()
                if (engineMode == "metric" && now - lastPlaybackLog >= 10000) {
                    lastPlaybackLog = now
                    val metric = json.optJSONObject("metric")
                    val diagnostic = JSONObject().put("track", json.optJSONObject("current")?.optString("id"))
                        .put("position", json.optDouble("position")).put("playing", json.optBoolean("playing"))
                        .put("paused", json.optBoolean("paused")).put("buffering", json.optBoolean("buffering"))
                        .put("phase", metric?.optString("phase")).put("notice", metric?.optString("notice"))
                        .put("error", json.optString("error")).put("audioHealth", json.optJSONObject("audioHealth"))
                        .put("orderedSet", metric?.optJSONObject("orderedSet"))
                    android.util.Log.i("HarBeatPlayback", diagnostic.toString())
                }
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
        @JavascriptInterface fun supportsBackgroundPlayback(): Boolean = true
        @JavascriptInterface fun requestMetric(id: Int, text: String) {
            requestPreparation(id, text, false)
        }
        @JavascriptInterface fun requestPlan(id: Int, text: String) {
            requestPreparation(id, text, true)
        }
        private fun requestPreparation(id: Int, text: String, dataPlan: Boolean) {
            fun reply(value: String) { handler.post {
                val event = if (dataPlan) "harbeat-plan-result" else "harbeat-metric-result"
                if (!disposed) web.evaluateJavascript("window.dispatchEvent(new CustomEvent('$event',{detail:{id:$id,reply:${JSONObject.quote(value)}}}));", null)
            } }
            if (disposed || id <= 0 || text.toByteArray().size > 8192) {
                reply(JSONObject().put("ok", false).put("error", "上一条准备请求仍在连接，请稍后重试").toString()); return
            }
            if (!metricSlot.tryAcquire()) {
                reply(JSONObject().put("ok", false).put("httpStatus", 429).put("retryAfterMs", 10000)
                    .put("error", "上一条准备请求仍在连接，正在等待后重试").toString()); return
            }
            try { metricRequests.execute {
                val value = prepareMetric(text, dataPlan)
                metricSlot.release(); reply(value)
            } } catch (_: Exception) { metricSlot.release() }
        }
        private fun prepareMetric(text: String, dataPlan: Boolean): String {
            return try {
                check(text.toByteArray().size <= 8192)
                val body = JSONObject(text)
                check(PlanRequestPolicy.allowed(dataPlan, body.keys().asSequence().toSet(), if (body.has("stemTimelineVersion")) body.getString("stemTimelineVersion") else null))
                for (key in listOf("from", "to", "windowId")) check(body.getString(key).matches(Regex("[A-Za-z0-9_-]{1,160}")))
                check(body.getString("from") != body.getString("to"))
                val start = body.getDouble("start"); check(start.isFinite() && start >= 0 && start <= 86400)
                val endpoint = if (dataPlan) "plans" else "jobs"
                val path = "/listen/smart-api/$endpoint"
                fun post(origin: String): JSONObject {
                    val connection = URL("$origin$path").openConnection() as HttpURLConnection
                    return try {
                        connection.requestMethod = "POST"; connection.doOutput = true
                        connection.connectTimeout = if (origin == publicOrigin) 10000 else 1500; connection.readTimeout = 20000; connection.instanceFollowRedirects = false
                        connection.setRequestProperty("Content-Type", "application/json")
                        connection.setRequestProperty("Origin", origin)
                        connection.outputStream.use { it.write(body.toString().toByteArray()) }
                        val code = connection.responseCode
                        val stream = if (code in 200..299) connection.inputStream else connection.errorStream
                        val output = ByteArrayOutputStream()
                        stream?.use { input ->
                            val buffer = ByteArray(8192)
                            while (true) {
                                val n = input.read(buffer); if (n < 0) break
                                check(output.size() + n <= 1024 * 1024)
                                output.write(buffer, 0, n)
                            }
                        }
                        val bytes = output.toByteArray()
                        val data = runCatching { JSONObject(String(bytes, Charsets.UTF_8)) }.getOrNull()
                        if (code in 200..299) {
                            check(data != null)
                            JSONObject().put("ok", true).put("data", data)
                        } else {
                            val retryMs = ((connection.getHeaderField("Retry-After")?.toLongOrNull() ?: 10L) * 1000L).coerceIn(2000L, 60000L)
                            JSONObject().put("ok", false).put("httpStatus", code)
                                .put("retryAfterMs", if (code == 429) retryMs else 0L)
                                .put("error", data?.optString("detail")?.takeIf { it.isNotBlank() }
                                    ?: if (code == 429) "策略请求暂时繁忙，正在等待后重试" else "云端暂不可用（$code）")
                        }
                    } finally { connection.disconnect() }
                }
                val origin = executionOrigin(path)
                val trial = if (origin != publicOrigin) runCatching { post(origin) }.getOrNull() else null
                if (trial != null && trial.optInt("httpStatus") != 404) trial.toString()
                else post(publicOrigin).toString()
            } catch (_: Exception) { JSONObject().put("ok", false).put("error", "混音服务连接未完成，请重试").toString() }
        }
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
                    val dir = File(context.getExternalFilesDir(null), "mix-logs").apply { mkdirs() }
                    val temp = File(dir, "last-session.tmp")
                    temp.writeText(text)
                    temp.renameTo(File(dir, "last-session.json"))
                    if (JSONObject(text).optJSONObject("orderedSet")?.optString("state") == "complete") {
                        val setTemp = File(dir, "toucan-set-completed.tmp")
                        setTemp.writeText(text)
                        setTemp.renameTo(File(dir, "toucan-set-completed.json"))
                    }
                }
            }
        }
        @JavascriptInterface fun exportLog(text: String, format: String) {
            if (format !in listOf("json", "md") || text.toByteArray().size > 20 * 1024 * 1024) return
            if (format == "json" && !validSession(text)) return
            if (!exports.isShutdown) exports.execute {
                val result = runCatching {
                    val prefix = if (engineMode == "longmix") "HarBeat-Longmix" else "HarBeat-V3"
                    val name = "$prefix-${System.currentTimeMillis()}.$format"
                    if (Build.VERSION.SDK_INT >= 29) {
                        val values = ContentValues().apply {
                            put(MediaStore.Downloads.DISPLAY_NAME, name)
                            put(MediaStore.Downloads.MIME_TYPE, if (format == "json") "application/json" else "text/markdown")
                            put(MediaStore.Downloads.RELATIVE_PATH, "Download/HarBeat")
                            put(MediaStore.Downloads.IS_PENDING, 1)
                        }
                        val uri = context.contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: error("无法创建文件")
                        try {
                            context.contentResolver.openOutputStream(uri)?.use { it.write(text.toByteArray()) } ?: error("无法写入文件")
                            context.contentResolver.update(uri, ContentValues().apply { put(MediaStore.Downloads.IS_PENDING, 0) }, null, null)
                        } catch (e: Exception) { context.contentResolver.delete(uri, null, null); throw e }
                        "已保存到 下载 / HarBeat"
                    } else {
                        File(context.getExternalFilesDir(null), "mix-logs").apply { mkdirs() }.resolve(name).writeText(text)
                        "已保存到 App 的 mix-logs 文件夹"
                    }
                }
                handler.post { Toast.makeText(context, result.getOrElse { "保存失败，请重试" }, Toast.LENGTH_LONG).show() }
            }
        }
        private fun validSession(text: String): Boolean = text.toByteArray().size <= 20 * 1024 * 1024 &&
            runCatching { JSONObject(text).optString("schema") in listOf("harbeat.v3_live_session.v2", "harbeat.metric-mix-session.v1", "harbeat.longmix-lab-session.v1") }.getOrDefault(false)
    }
}
