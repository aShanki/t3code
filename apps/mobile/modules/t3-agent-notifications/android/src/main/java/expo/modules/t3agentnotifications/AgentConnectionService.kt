package expo.modules.t3agentnotifications

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat

/**
 * Keeps the app process, and with it the environment connections, alive in the background
 * for builds without relay push, so their local agent alerts still arrive. It only holds
 * the process; the alerts come from the JavaScript side through [AgentNotifications.receive].
 */
class AgentConnectionService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val text = intent?.getStringExtra(EXTRA_TEXT) ?: "Connected to your T3 Code environments"
    val manager = getSystemService(NotificationManager::class.java)
    if (Build.VERSION.SDK_INT >= 26) {
      manager.createNotificationChannel(
        NotificationChannel(CHANNEL, "Background connection", NotificationManager.IMPORTANCE_MIN)
      )
    }
    val launch = packageManager.getLaunchIntentForPackage(packageName)?.let {
      PendingIntent.getActivity(this, ID, it, PendingIntent.FLAG_IMMUTABLE)
    }
    val notification = NotificationCompat.Builder(this, CHANNEL)
      .setSmallIcon(R.drawable.agent_activity_mark)
      .setContentTitle("Listening for agent updates")
      .setContentText(text)
      .setOngoing(true)
      .setSilent(true)
      .setShowWhen(false)
      .setPriority(NotificationCompat.PRIORITY_MIN)
      .setContentIntent(launch)
      .build()
    if (Build.VERSION.SDK_INT >= 34) {
      startForeground(ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING)
    } else {
      startForeground(ID, notification)
    }
    // A restarted process has no JavaScript runtime to stream alerts; the app starts it again.
    return START_NOT_STICKY
  }

  companion object {
    private const val CHANNEL = "agent-connection"
    private const val ID = 73002
    private const val EXTRA_TEXT = "text"

    fun start(context: Context, text: String) {
      ContextCompat.startForegroundService(
        context,
        Intent(context, AgentConnectionService::class.java).putExtra(EXTRA_TEXT, text)
      )
    }

    fun stop(context: Context) {
      context.stopService(Intent(context, AgentConnectionService::class.java))
    }
  }
}
