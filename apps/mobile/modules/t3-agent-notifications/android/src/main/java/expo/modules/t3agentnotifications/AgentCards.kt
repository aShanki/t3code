package expo.modules.t3agentnotifications

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.os.Build
import android.os.Bundle
import androidx.core.app.NotificationCompat
import androidx.core.app.Person
import org.json.JSONArray
import org.json.JSONObject

/**
 * Cards: one notification per conversation and one per task, each replaced in place by the
 * next alert that names its slot (`alert_slot`). The shade then reads as a board of where every
 * task stands instead of a log of every message about it.
 *
 * A quiet alert (`alert_quiet`: progress, or an acknowledgement of the user's own message)
 * goes to a low-importance channel, so Android files its card under Silent. This device and
 * the fork's server both report a task event, so a second report of the state a card shows
 * updates its text without alerting again, and one with no text of its own (`alert_generic`)
 * never replaces one that has it.
 *
 * Cards carry no group: Android 16 regroups a grouped notification whose summary is not posted
 * yet, and shows a summary that outlives its children as a row of its own.
 */
internal object AgentCards {
  private const val TAG = "t3-agent-card"
  private const val TASK_CHANNEL = "task-updates"
  private const val QUIET_CHANNEL = "quiet-updates"
  private const val TASK_SLOT = "task:"
  private const val EXTRA_STATE = "t3.card.state"
  private const val EXTRA_POSTED = "t3.card.posted"
  private const val EXTRA_PATH = "t3.card.path"
  private const val EXTRA_THREAD = "t3.card.thread"
  private const val EXTRA_GENERIC = "t3.card.generic"
  private const val CHAT_LINES_KEY = "chatCardLines"

  /** Reports of one task event arrive within this long of each other. */
  private const val SAME_EVENT_MS = 3 * 60 * 1000L
  private const val CHAT_LINES = 6

  /** States that wait on the user. */
  private val NEEDS = setOf("approval", "answer", "attention")

  fun handles(data: Map<String, String>) = !data["alert_slot"].isNullOrBlank()

  @Synchronized
  fun post(context: Context, scheme: String, data: Map<String, String>, chatChannel: String) {
    val slot = data["alert_slot"] ?: return
    val manager = manager(context)
    val id = slot.hashCode()
    val now = System.currentTimeMillis()
    val state = data["alert_state"]
    val generic = data["alert_generic"] == "1"
    val shown = manager.activeNotifications.firstOrNull { it.tag == TAG && it.id == id }
      ?.notification?.extras
    val sameEvent = shown != null && state != null && shown.getString(EXTRA_STATE) == state &&
      now - shown.getLong(EXTRA_POSTED) < SAME_EVENT_MS
    if (sameEvent && generic && !shown!!.getBoolean(EXTRA_GENERIC)) return
    val quiet = data["alert_quiet"] == "1"
    val extras = Bundle().apply {
      putString(EXTRA_STATE, state)
      putLong(EXTRA_POSTED, now)
      putString(EXTRA_PATH, data["alert_path"])
      putString(EXTRA_THREAD, data["alert_thread"])
      putBoolean(EXTRA_GENERIC, generic)
    }
    val prefs = context.getSharedPreferences(STORE, Context.MODE_PRIVATE)
    val open = AgentNotifications.contentIntent(context, scheme, data["alert_path"], id)
    channels(context)
    if (slot.startsWith(TASK_SLOT)) {
      val title = data["alert_title"].orEmpty().take(120)
      val body = data["alert_body"].orEmpty().take(608)
      val builder = base(context, if (quiet) QUIET_CHANNEL else TASK_CHANNEL, quiet)
        .setOnlyAlertOnce(sameEvent)
        .setContentTitle(title).setContentText(body)
        .setStyle(NotificationCompat.BigTextStyle().bigText(body))
        .setColor(color(state))
        .setWhen(now)
        .setContentIntent(open)
        .addExtras(extras)
      val thread = data["alert_thread"]
      if (thread != null && thread != data["alert_path"]) {
        AgentNotifications.contentIntent(context, scheme, thread, id)?.let {
          builder.addAction(0, "Open task", it)
        }
      }
      manager.notify(TAG, id, builder.build())
    } else {
      val sender = data["alert_title"].orEmpty().take(120)
      // A card the owner dismissed or opened starts again from this message.
      val earlier = if (shown == null) emptyList() else chatLines(prefs.getString(CHAT_LINES_KEY, null))
      val lines = (earlier + ChatLine(data["alert_body"].orEmpty().take(608), now)).takeLast(CHAT_LINES)
      prefs.edit().putString(
        CHAT_LINES_KEY,
        JSONArray(lines.map { JSONObject().put("text", it.text).put("time", it.time) }).toString()
      ).apply()
      val from = Person.Builder().setName(sender).build()
      val style = NotificationCompat.MessagingStyle(Person.Builder().setName("You").build())
      lines.forEach { style.addMessage(it.text, it.time, from) }
      val builder = base(context, if (quiet) QUIET_CHANNEL else chatChannel, quiet)
        .setContentTitle(sender).setContentText(lines.last().text)
        .setStyle(style)
        .setCategory(NotificationCompat.CATEGORY_MESSAGE)
        .setWhen(now)
        .setContentIntent(open)
        .addExtras(extras)
      manager.notify(TAG, id, builder.build())
    }
  }

  /** The user has read whatever opens at `path`: its cards have nothing left to say. */
  @Synchronized
  fun seen(context: Context, path: String) {
    val manager = manager(context)
    manager.activeNotifications.filter {
      it.tag == TAG && (
        it.notification.extras.getString(EXTRA_PATH) == path ||
          it.notification.extras.getString(EXTRA_THREAD) == path
        )
    }.forEach { manager.cancel(TAG, it.id) }
  }

  @Synchronized
  fun clear(context: Context) {
    val manager = manager(context)
    manager.activeNotifications.filter { it.tag == TAG }.forEach { manager.cancel(TAG, it.id) }
    context.getSharedPreferences(STORE, Context.MODE_PRIVATE).edit().remove(CHAT_LINES_KEY).apply()
  }

  private data class ChatLine(val text: String, val time: Long)

  private fun chatLines(stored: String?): List<ChatLine> = try {
    val array = JSONArray(stored ?: "[]")
    (0 until array.length()).map {
      val line = array.getJSONObject(it)
      ChatLine(line.getString("text"), line.getLong("time"))
    }
  } catch (_: Exception) {
    emptyList()
  }

  private fun base(context: Context, channel: String, quiet: Boolean) =
    NotificationCompat.Builder(context, channel)
      .setSmallIcon(R.drawable.agent_activity_mark)
      .setPriority(if (quiet) NotificationCompat.PRIORITY_LOW else NotificationCompat.PRIORITY_HIGH)
      .setDefaults(if (quiet) 0 else NotificationCompat.DEFAULT_ALL)
      .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
      .setShowWhen(true)
      .setAutoCancel(true)

  private fun color(state: String?) = when (state) {
    in NEEDS -> 0xFFF59E0B.toInt()
    "failed" -> 0xFFEF4444.toInt()
    "working" -> 0xFF3B82F6.toInt()
    "stopped" -> 0xFF9CA3AF.toInt()
    else -> 0xFF22C55E.toInt()
  }

  private fun channels(context: Context) {
    if (Build.VERSION.SDK_INT >= 26) {
      manager(context).createNotificationChannels(
        listOf(
          NotificationChannel(TASK_CHANNEL, "Task updates", NotificationManager.IMPORTANCE_HIGH),
          NotificationChannel(
            QUIET_CHANNEL,
            "Progress and acknowledgements",
            NotificationManager.IMPORTANCE_LOW
          ),
        )
      )
    }
  }

  private fun manager(context: Context) = context.getSystemService(NotificationManager::class.java)

  private const val STORE = "t3-agent-notifications-local"
}
