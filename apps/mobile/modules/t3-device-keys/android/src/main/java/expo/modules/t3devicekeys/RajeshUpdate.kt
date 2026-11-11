package expo.modules.t3devicekeys

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import java.io.File
import java.net.URL
import java.security.MessageDigest
import javax.net.ssl.HttpsURLConnection

/**
 * Installs a Rajesh chat release from this fork's GitHub Releases. The download must match the
 * release's SHA-256, and the package, version and signing certificate must match the installed
 * app before Android's installer opens; Android repeats the certificate check itself.
 */
object RajeshUpdate {
  private const val PACKAGE = "tech.ashank.t3code.chat"
  private const val MAX_BYTES = 300L * 1024 * 1024
  private const val MAX_REDIRECTS = 5

  internal fun releaseUrl(versionCode: Int) =
    "https://github.com/aShanki/t3code/releases/download/rajesh-chat-v$versionCode/rajesh-chat-arm64.apk"

  internal fun validDownloadHost(url: URL) =
    url.protocol == "https" &&
      url.userInfo == null &&
      (url.port == -1 || url.port == 443) &&
      (url.host == "github.com" || url.host.endsWith(".githubusercontent.com"))

  @Suppress("DEPRECATION")
  fun installedVersion(context: Context): Int =
    context.packageManager.getPackageInfo(context.packageName, 0).versionCode

  private fun downloads(context: Context) = File(context.cacheDir, "rajesh-updates")

  /** Removes the downloaded release, which Android leaves in place after installing it. */
  fun clearDownload(context: Context) {
    downloads(context).deleteRecursively()
  }

  fun install(context: Context, sha256: String, versionCode: Int) {
    require(context.packageName == PACKAGE) { "Updates are unavailable for this app." }
    require(versionCode > installedVersion(context)) { "This update is not newer than the installed app." }
    require(sha256.matches(Regex("[a-f0-9]{64}"))) { "Invalid update digest." }
    val packages = context.packageManager
    if (Build.VERSION.SDK_INT >= 26 && !packages.canRequestPackageInstalls()) {
      context.startActivity(
        Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:$PACKAGE"))
          .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      )
      error("Allow Rajesh chat to install apps, then check for updates again.")
    }
    val directory = downloads(context)
    check(directory.exists() || directory.mkdirs()) { "Cannot create the update folder." }
    val file = File(directory, "update.apk")
    try {
      check(download(URL(releaseUrl(versionCode)), file) == sha256) { "The update's checksum did not match." }
      verifyArchive(packages, file, versionCode)
      val uri = FileProvider.getUriForFile(context, "$PACKAGE.rajesh-updates", file)
      // Clears the installer's task: a screen left open by the last update would otherwise
      // come forward in place of this install.
      context.startActivity(
        Intent(Intent.ACTION_VIEW)
          .setDataAndType(uri, "application/vnd.android.package-archive")
          .addFlags(
            Intent.FLAG_ACTIVITY_NEW_TASK or
              Intent.FLAG_ACTIVITY_CLEAR_TASK or
              Intent.FLAG_GRANT_READ_URI_PERMISSION
          )
      )
    } catch (error: Exception) {
      file.delete()
      throw error
    }
  }

  /** Writes the file and returns its SHA-256, following redirects only between GitHub's hosts. */
  private fun download(start: URL, file: File): String {
    var url = start
    repeat(MAX_REDIRECTS + 1) {
      require(validDownloadHost(url)) { "The update came from an unexpected host." }
      val connection = url.openConnection() as HttpsURLConnection
      try {
        connection.instanceFollowRedirects = false
        connection.connectTimeout = 15_000
        connection.readTimeout = 30_000
        connection.setRequestProperty("User-Agent", "Rajesh-chat")
        val status = connection.responseCode
        if (status in 300..399) {
          url = URL(url, connection.getHeaderField("Location") ?: error("The download redirect was empty."))
          return@repeat
        }
        check(status == 200) { "The download failed ($status)." }
        val digest = MessageDigest.getInstance("SHA-256")
        var bytes = 0L
        connection.inputStream.use { input ->
          file.outputStream().use { output ->
            val buffer = ByteArray(65_536)
            while (true) {
              val count = input.read(buffer)
              if (count < 0) break
              bytes += count
              check(bytes <= MAX_BYTES) { "The update is too large." }
              digest.update(buffer, 0, count)
              output.write(buffer, 0, count)
            }
          }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
      } finally {
        connection.disconnect()
      }
    }
    error("The download redirected too many times.")
  }

  // GET_SIGNATURES is the flag getPackageArchiveInfo honours on every supported Android version.
  @Suppress("DEPRECATION")
  private fun verifyArchive(packages: PackageManager, file: File, versionCode: Int) {
    val archive =
      packages.getPackageArchiveInfo(file.absolutePath, PackageManager.GET_SIGNATURES)
        ?: error("The update is not a valid Android package.")
    check(archive.packageName == PACKAGE && archive.versionCode == versionCode) {
      "The update's package or version did not match."
    }
    val installed = packages.getPackageInfo(PACKAGE, PackageManager.GET_SIGNATURES).signatures
    val offered = archive.signatures
    check(!offered.isNullOrEmpty() && offered.toSet() == installed?.toSet()) {
      "The update's signing certificate did not match."
    }
  }
}
