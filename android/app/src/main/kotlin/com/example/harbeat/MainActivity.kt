package com.example.harbeat

import com.ryanheise.audioservice.AudioServiceActivity
import android.os.Build
import android.content.ActivityNotFoundException
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.media.AudioManager
import android.os.IBinder
import android.view.WindowManager
import io.flutter.plugin.common.EventChannel
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : AudioServiceActivity() {
    private var playback: RealtimePlaybackService? = null
    private var playbackBound = false
    private var resumed = false
    private data class Request(val method: String, val args: Map<String, Any?>, val result: MethodChannel.Result)
    private val waiting = mutableListOf<Request>()
    private val playbackConnection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName, binder: IBinder) {
            val service = (binder as RealtimePlaybackService.LocalBinder).service
            playback = service
            service.attach(this@MainActivity, resumed, ::publish)
            waiting.toList().also { waiting.clear() }.forEach { service.command(it.method, it.args, it.result) }
        }

        override fun onServiceDisconnected(name: ComponentName) {
            playback = null
            publish(emptyMap())
        }
    }

    private fun publish(state: Map<String, Any?>) {
        if (resumed && (state["playing"] == true || state["busy"] == true ||
                (state["buffering"] == true && state["paused"] != true))) {
            window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        } else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        lastState = state
        stateSink?.success(state)
    }

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        volumeControlStream = AudioManager.STREAM_MUSIC
        playbackBound = bindService(Intent(this, RealtimePlaybackService::class.java),
            playbackConnection, Context.BIND_AUTO_CREATE)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "harbeat/platform")
            .setMethodCallHandler { call, result ->
                if (call.method == "sdkInt") result.success(Build.VERSION.SDK_INT)
                else if (call.method == "openStableMix") {
                    try {
                        val intent = Intent(Intent.ACTION_MAIN).apply {
                            component = ComponentName("com.example.harbeat.nativeqa", "com.example.harbeat.MainActivity")
                            addCategory(Intent.CATEGORY_LAUNCHER)
                            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                        }
                        startActivity(intent)
                        result.success(null)
                    } catch (_: ActivityNotFoundException) {
                        result.error("stable_missing", "未找到已安装的稳定版，请从桌面打开普通混音 App", null)
                    } catch (_: SecurityException) {
                        result.error("stable_unavailable", "无法打开稳定版，请从桌面打开", null)
                    }
                } else result.notImplemented()
            }
        EventChannel(flutterEngine.dartExecutor.binaryMessenger, "harbeat/realtime/state")
            .setStreamHandler(stateStream)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "harbeat/realtime")
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "command" -> {
                        val request = Request(call.argument<String>("method") ?: "",
                            call.argument<Map<String, Any?>>("args") ?: emptyMap(), result)
                        val service = playback
                        if (service != null) service.command(request.method, request.args, result)
                        else if (playbackBound) waiting.add(request)
                        else result.error("unavailable", "实时播放服务无法启动", null)
                    }
                    "dispose" -> {
                        waiting.forEach { it.result.error("closed", "实时引擎已关闭", null) }
                        waiting.clear()
                        playback?.disposePlayback()
                        result.success(null)
                    }
                    else -> result.notImplemented()
                }
            }
    }
    override fun onPause() {
        resumed = false
        playback?.setVisible(this, false)
        window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        super.onPause()
    }

    override fun onResume() {
        super.onResume()
        resumed = true
        playback?.let {
            it.setVisible(this, true)
            publish(it.snapshot())
        }
    }

    override fun onDestroy() {
        waiting.forEach { it.result.error("closed", "播放页面已关闭", null) }
        waiting.clear()
        playback?.detach(this)
        playback = null
        if (playbackBound) unbindService(playbackConnection)
        super.onDestroy()
    }

    override fun cleanUpFlutterEngine(flutterEngine: FlutterEngine) {
        val messenger = flutterEngine.dartExecutor.binaryMessenger
        MethodChannel(messenger, "harbeat/realtime").setMethodCallHandler(null)
        MethodChannel(messenger, "harbeat/platform").setMethodCallHandler(null)
        super.cleanUpFlutterEngine(flutterEngine)
    }

    companion object {
        // The audio-service Flutter engine can outlive an Activity instance.
        private var stateSink: EventChannel.EventSink? = null
        private var lastState = emptyMap<String, Any?>()
        private val stateStream = object : EventChannel.StreamHandler {
            override fun onListen(arguments: Any?, sink: EventChannel.EventSink) {
                stateSink = sink
                if (lastState.isNotEmpty()) sink.success(lastState)
            }
            override fun onCancel(arguments: Any?) { stateSink = null }
        }
    }
}
