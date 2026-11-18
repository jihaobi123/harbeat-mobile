package com.example.harbeat

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.media.MediaMetadata
import android.os.Binder
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import android.util.Log
import io.flutter.plugin.common.MethodChannel

/** Owns the realtime audio clock and system transport controls, including without an Activity. */
class RealtimePlaybackService : Service() {
    inner class LocalBinder : Binder() {
        val service: RealtimePlaybackService get() = this@RealtimePlaybackService
    }

    private val handler = Handler(Looper.getMainLooper())
    private val binder = LocalBinder()
    private lateinit var session: MediaSession
    private lateinit var notifications: NotificationManager
    private lateinit var wakeLock: PowerManager.WakeLock
    private lateinit var openPlayer: PendingIntent
    private var engine: RealtimeMixEngine? = null
    private var owner: Any? = null
    private var listener: ((Map<String, Any?>) -> Unit)? = null
    private var visible = false
    private var promoted = false
    private var preparing = false
    private var ending = false
    private var latest = emptyMap<String, Any?>()
    private var card: Card? = null
    private val endPlayback = Runnable {
        ending = false
        if (promoted && !hasPlayback(latest)) demote()
    }
    private val idleExpiry = Runnable {
        if (promoted && (preparing || latest["paused"] == true)) {
            if (preparing) engine?.pause()
            demote()
        }
    }

    private data class Card(
        val id: String, val title: String, val subtitle: String, val duration: Long,
        val paused: Boolean, val next: Boolean
    )

    override fun onCreate() {
        super.onCreate()
        notifications = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= 26) {
            notifications.createNotificationChannel(
                NotificationChannel(CHANNEL, "HarBeat 实时播放", NotificationManager.IMPORTANCE_LOW)
            )
        }
        wakeLock = getSystemService(PowerManager::class.java)
            .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "$packageName:RealtimePlayback")
        openPlayer = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java)
            .setAction(Intent.ACTION_MAIN)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        session = MediaSession(this, "HarBeat Realtime").apply {
            setSessionActivity(openPlayer)
            setCallback(object : MediaSession.Callback() {
                override fun onPlay() = transport(PLAY)
                override fun onPause() = transport(PAUSE)
                override fun onStop() = transport(STOP)
                override fun onSkipToNext() = transport(NEXT)
                override fun onSeekTo(pos: Long) = seek(pos)
            }, handler)
        }
    }

    override fun onBind(intent: Intent?): IBinder = binder

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        intent?.action?.let { action ->
            if (action != KEEP_ALIVE) transport(action)
        }
        if (!promoted) stopSelf(startId)
        return START_NOT_STICKY
    }

    fun attach(owner: Any, visible: Boolean, listener: (Map<String, Any?>) -> Unit) {
        this.owner = owner
        this.listener = listener
        setVisible(owner, visible)
        if (latest.isNotEmpty()) listener(latest)
    }

    fun detach(owner: Any) {
        if (this.owner !== owner) return
        setVisible(owner, false)
        this.owner = null
        listener = null
    }

    fun setVisible(owner: Any, visible: Boolean) {
        if (this.owner !== owner) return
        this.visible = visible
        if (visible) engine?.resume()
        else if (!promoted) engine?.pause()
    }

    fun command(method: String, args: Map<String, Any?>, result: MethodChannel.Result) {
        if (method == "prepare" && promoted) demote()
        val player = engine ?: RealtimeMixEngine(this, ::promote, ::onState).also { engine = it }
        player.command(method, args, result)
        if (method == "stop" && preparing) demote()
    }

    fun snapshot(): Map<String, Any?> = latest

    fun disposePlayback() {
        engine?.dispose()
        engine = null
        latest = emptyMap()
        demote()
        listener?.invoke(latest)
    }

    private fun promote(): Boolean {
        if (promoted) return true
        if (!visible) return false
        try {
            val intent = Intent(this, RealtimePlaybackService::class.java).setAction(KEEP_ALIVE)
            if (Build.VERSION.SDK_INT >= 26) startForegroundService(intent) else startService(intent)
            val initial = notification(Card("", "HarBeat", "正在准备音乐", 0L, false, false))
            if (Build.VERSION.SDK_INT >= 29) {
                startForeground(NOTIFICATION_ID, initial, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
            } else startForeground(NOTIFICATION_ID, initial)
            promoted = true
            preparing = true
            setAwake(true)
            handler.postDelayed(idleExpiry, 180_000L)
            return true
        } catch (error: IllegalStateException) {
            Log.w(TAG, "Cannot start foreground playback", error)
            stopSelf()
            return false
        } catch (error: SecurityException) {
            Log.w(TAG, "Cannot start foreground playback", error)
            stopSelf()
            return false
        }
    }

    private fun onState(state: Map<String, Any?>) {
        latest = state
        listener?.invoke(state)
        if (!promoted) return
        val paused = state["paused"] == true
        val playing = state["playing"] == true
        if (!hasPlayback(state)) {
            if (!ending && (!preparing || (state["error"] as? String)?.isNotBlank() == true)) {
                // stop(false) publishes an empty deck just before a seek or restart starts loading.
                ending = true
                handler.postDelayed(endPlayback, 600L)
            }
            return
        }
        ending = false
        handler.removeCallbacks(endPlayback)
        if (preparing && !playing && !paused && state["current"] !is Map<*, *> &&
                state["buffering"] != true) return
        // Web Audio can still be resuming after the user has cleared its paused flag.
        val buffering = !playing && !paused
        if (preparing || paused != card?.paused) {
            handler.removeCallbacks(idleExpiry)
            if (paused) handler.postDelayed(idleExpiry, 600_000L)
        }
        preparing = false
        setAwake(playing || buffering)
        val current = state["current"] as? Map<*, *>
        val scene = (state["scene"] ?: state["case"]) as? Map<*, *>
        val title = (current?.get("title") ?: scene?.get("title")) as? String ?: card?.title ?: "HarBeat"
        val subtitle = (current?.get("collection") ?: current?.get("style")) as? String ?: card?.subtitle ?: "HarBeat 实时播放"
        val id = (current?.get("id") ?: scene?.get("id")) as? String ?: card?.id.orEmpty()
        val duration = millis(state["duration"]).takeIf { it > 0 } ?: card?.duration ?: 0L
        val updated = Card(id, title, subtitle, duration, paused, canSkip(state))
        if (card != updated) {
            card = updated
            session.setMetadata(MediaMetadata.Builder()
                .putString(MediaMetadata.METADATA_KEY_MEDIA_ID, updated.id)
                .putString(MediaMetadata.METADATA_KEY_TITLE, title)
                .putString(MediaMetadata.METADATA_KEY_ARTIST, subtitle)
                .putLong(MediaMetadata.METADATA_KEY_DURATION, updated.duration)
                .build())
            session.isActive = true
            notifications.notify(NOTIFICATION_ID, notification(updated))
        }
        var actions = PlaybackState.ACTION_STOP or PlaybackState.ACTION_PLAY_PAUSE
        actions = actions or if (paused) PlaybackState.ACTION_PLAY else PlaybackState.ACTION_PAUSE
        if (updated.next) actions = actions or PlaybackState.ACTION_SKIP_TO_NEXT
        if (canSeek(state)) actions = actions or PlaybackState.ACTION_SEEK_TO
        val status = when {
            paused -> PlaybackState.STATE_PAUSED
            buffering -> PlaybackState.STATE_BUFFERING
            else -> PlaybackState.STATE_PLAYING
        }
        session.setPlaybackState(PlaybackState.Builder().setActions(actions)
            .setState(status, millis(state["position"]), if (playing) 1f else 0f, SystemClock.elapsedRealtime())
            .build())
    }

    private fun hasPlayback(state: Map<String, Any?>): Boolean =
        state["current"] is Map<*, *> || state["playing"] == true ||
            state["paused"] == true || state["busy"] == true || state["buffering"] == true

    private fun canSkip(state: Map<String, Any?>): Boolean {
        val metric = state["metric"] as? Map<*, *>
        return state["playing"] == true && state["current"] is Map<*, *> &&
            (state["pending"] as? Map<*, *>)?.get("locked") != true &&
            metric?.get("orderedSet") == null
    }

    private fun canSeek(state: Map<String, Any?>): Boolean =
        state["current"] is Map<*, *> && state["dance"] == null && state["pending"] == null

    private fun millis(value: Any?): Long =
        ((value as? Number)?.toDouble()?.takeIf { it.isFinite() && it >= 0 }?.times(1000))?.toLong() ?: 0L

    private fun seek(position: Long) {
        if (promoted && canSeek(latest)) mediaCommand("seek", mapOf("position" to position.coerceAtLeast(0) / 1000.0))
    }

    private fun transport(action: String) {
        if (!promoted) return
        val reference = latest["mode"] == "dj-reference"
        when (action) {
            PLAY -> if (latest["paused"] == true) mediaCommand(if (reference) "djResume" else "resume")
            PAUSE -> if (latest["paused"] != true) mediaCommand(if (reference) "djPause" else "pause")
            STOP -> {
                mediaCommand("stop")
                if (preparing) demote()
            }
            NEXT -> if (canSkip(latest)) {
                if (latest["metric"] is Map<*, *>) mediaCommand("mixSoon")
                else mediaCommand("request", mapOf("intent" to mapOf("kind" to "next")))
            }
        }
    }

    private fun mediaCommand(method: String, args: Map<String, Any?> = emptyMap()) {
        engine?.command(method, args, object : MethodChannel.Result {
            override fun success(result: Any?) = Unit
            override fun error(code: String, message: String?, details: Any?) {
                Log.i(TAG, "Media action $method was not applied: $code")
            }
            override fun notImplemented() = Unit
        })
    }

    private fun action(name: String, label: String, icon: Int) =
        Notification.Action.Builder(icon, label, PendingIntent.getService(
            this, 0, Intent(this, RealtimePlaybackService::class.java).setAction(name),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )).build()

    private fun notification(card: Card): Notification {
        val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, CHANNEL)
                      else Notification.Builder(this)
        builder.setSmallIcon(R.drawable.ic_media_note)
            .setContentTitle(card.title).setContentText(card.subtitle)
            .setContentIntent(openPlayer).setVisibility(Notification.VISIBILITY_PUBLIC)
            .setCategory(Notification.CATEGORY_TRANSPORT).setOnlyAlertOnce(true)
            .setShowWhen(false).setOngoing(true)
            .addAction(if (card.paused) action(PLAY, "继续播放", android.R.drawable.ic_media_play)
                       else action(PAUSE, "暂停", android.R.drawable.ic_media_pause))
        if (card.next) builder.addAction(action(NEXT, "下一首", android.R.drawable.ic_media_next))
        builder.addAction(action(STOP, "停止", android.R.drawable.ic_menu_close_clear_cancel))
        val style = Notification.MediaStyle().setMediaSession(session.sessionToken)
        if (card.next) style.setShowActionsInCompactView(0, 1) else style.setShowActionsInCompactView(0)
        return builder.setStyle(style).build()
    }

    private fun setAwake(keep: Boolean) {
        if (keep && !wakeLock.isHeld) wakeLock.acquire()
        if (!keep && wakeLock.isHeld) wakeLock.release()
    }

    private fun demote() {
        if (!promoted) return
        promoted = false
        preparing = false
        ending = false
        card = null
        handler.removeCallbacks(idleExpiry)
        handler.removeCallbacks(endPlayback)
        setAwake(false)
        engine?.releaseFocus()
        session.isActive = false
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onDestroy() {
        listener = null
        disposePlayback()
        session.release()
        super.onDestroy()
    }

    companion object {
        private const val TAG = "HarBeatMedia"
        private const val CHANNEL = "harbeat_realtime_playback"
        private const val NOTIFICATION_ID = 28261
        private const val KEEP_ALIVE = "com.example.harbeat.realtime.KEEP_ALIVE"
        private const val PLAY = "com.example.harbeat.realtime.PLAY"
        private const val PAUSE = "com.example.harbeat.realtime.PAUSE"
        private const val NEXT = "com.example.harbeat.realtime.NEXT"
        private const val STOP = "com.example.harbeat.realtime.STOP"
    }
}
