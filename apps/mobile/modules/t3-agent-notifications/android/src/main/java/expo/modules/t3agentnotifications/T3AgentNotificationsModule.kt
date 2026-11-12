package expo.modules.t3agentnotifications

import android.content.ActivityNotFoundException
import android.content.Intent
import android.os.Build
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class T3AgentNotificationsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("T3AgentNotifications")

    Function("configure") {
        deviceId: String,
        userId: String,
        scheme: String,
        ongoingEnabled: Boolean
      ->
      appContext.reactContext?.let {
        AgentNotifications.configure(it, deviceId, userId, scheme, ongoingEnabled)
      }
    }

    Function("clear") {
      appContext.reactContext?.let { AgentNotifications.clear(it) }
    }

    Function("showShowcaseActivity") { scheme: String, data: Map<String, String> ->
      appContext.reactContext?.let { AgentNotifications.showcase(it, scheme, data) }
    }

    // Local alerts render through the same path as relay pushes.
    Function("receiveLocal") { scheme: String, data: Map<String, String> ->
      appContext.reactContext?.let { AgentNotifications.receiveLocal(it, scheme, data) }
    }

    Function("receiveLocalLater") {
        scheme: String,
        data: Map<String, String>,
        delayMs: Double,
        key: String
      ->
      appContext.reactContext?.let {
        AgentNotifications.receiveLater(it, scheme, data, delayMs.toLong(), key)
      }
    }

    Function("cancelLocalLater") { key: String ->
      AgentNotifications.cancelLater(key)
    }

    Function("setBackgroundConnection") { enabled: Boolean, text: String ->
      appContext.reactContext?.let {
        if (enabled) AgentConnectionService.start(it, text) else AgentConnectionService.stop(it)
      }
    }

    Function("setThreadOnScreen") { path: String? ->
      AgentNotifications.setThreadOnScreen(path)
    }

    Function("setChatPush") { scheme: String? ->
      appContext.reactContext?.let { AgentNotifications.setChatPush(it, scheme) }
    }

    Function("setChatOnScreen") { visible: Boolean ->
      AgentNotifications.setChatOnScreen(visible)
    }

    Function("openLiveUpdateSettings") {
      val context = appContext.reactContext
      if (context == null || Build.VERSION.SDK_INT < 36) {
        false
      } else {
        try {
          context.startActivity(
            Intent(Settings.ACTION_APP_NOTIFICATION_PROMOTION_SETTINGS)
              .putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
              .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
          )
          true
        } catch (_: ActivityNotFoundException) {
          false
        }
      }
    }
  }
}
