package expo.modules.t3agentnotifications

import android.app.Activity
import android.content.Context
import android.content.Intent
import expo.modules.core.interfaces.Package
import expo.modules.core.interfaces.ReactActivityLifecycleListener

class T3AgentNotificationsPackage : Package {
  override fun createReactActivityLifecycleListeners(
    activityContext: Context
  ): List<ReactActivityLifecycleListener> = listOf(
    object : ReactActivityLifecycleListener {
      /**
       * Android restarts a killed app with its old intent and hands a tapped notification's
       * link over before JavaScript runs, where React Native drops it. Kept as the activity's
       * intent, the link is the launch URL JavaScript reads once it starts.
       */
      override fun onNewIntent(intent: Intent?): Boolean {
        if (intent?.data != null) (activityContext as? Activity)?.intent = intent
        return false
      }
    }
  )
}
