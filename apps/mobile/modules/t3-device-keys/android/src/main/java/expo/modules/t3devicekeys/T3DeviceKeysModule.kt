package expo.modules.t3devicekeys

import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class T3DeviceKeysModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("T3DeviceKeys")

    AsyncFunction("ensureKey") { alias: String -> DeviceKeys.ensure(alias) }

    AsyncFunction("sign") { alias: String, data: String -> DeviceKeys.sign(alias, data) }

    AsyncFunction("deleteKey") { alias: String -> DeviceKeys.delete(alias) }

    AsyncFunction("installedVersion") {
      RajeshUpdate.installedVersion(requireNotNull(appContext.reactContext))
    }

    // Off the shared module queue: the download would otherwise stall every other async call.
    AsyncFunction("installRelease") Coroutine { sha256: String, versionCode: Int ->
      val context = requireNotNull(appContext.reactContext)
      withContext(Dispatchers.IO) { RajeshUpdate.install(context, sha256, versionCode) }
    }
  }
}
