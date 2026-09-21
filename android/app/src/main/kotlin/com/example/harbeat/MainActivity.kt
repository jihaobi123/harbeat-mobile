package com.example.harbeat

import com.ryanheise.audioservice.AudioServiceActivity
import android.os.Build
import io.flutter.plugin.common.EventChannel
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : AudioServiceActivity() {
    private var realtime: RealtimeMixEngine? = null
    private var stateSink: EventChannel.EventSink? = null
    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "harbeat/platform")
            .setMethodCallHandler { call, result ->
                if (call.method == "sdkInt") result.success(Build.VERSION.SDK_INT)
                else result.notImplemented()
            }
        EventChannel(flutterEngine.dartExecutor.binaryMessenger, "harbeat/realtime/state")
            .setStreamHandler(object : EventChannel.StreamHandler {
                override fun onListen(arguments: Any?, sink: EventChannel.EventSink) { stateSink = sink }
                override fun onCancel(arguments: Any?) { stateSink = null }
            })
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "harbeat/realtime")
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "command" -> {
                        if (realtime == null) realtime = RealtimeMixEngine(this) { stateSink?.success(it) }
                        realtime!!.command(call.argument<String>("method") ?: "", call.argument<Map<String, Any?>>("args") ?: emptyMap<String, Any?>(), result)
                    }
                    "dispose" -> { realtime?.dispose(); realtime = null; result.success(null) }
                    else -> result.notImplemented()
                }
            }
    }
    override fun onPause() { realtime?.pause(); super.onPause() }
    override fun onResume() { super.onResume(); realtime?.resume() }
    override fun onDestroy() { realtime?.dispose(); realtime = null; super.onDestroy() }
}
