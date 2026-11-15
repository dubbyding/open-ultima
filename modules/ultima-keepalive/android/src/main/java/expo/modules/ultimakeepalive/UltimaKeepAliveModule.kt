package expo.modules.ultimakeepalive

import android.content.Intent
import androidx.core.content.ContextCompat
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class UltimaKeepAliveModule : Module() {
  private val context
    get() = appContext.reactContext ?: throw CodedException("ERR_NO_CONTEXT", "React context unavailable", null)

  override fun definition() = ModuleDefinition {
    Name("UltimaKeepAlive")

    /** Starts (or updates) the foreground service. Throws if Android refuses (e.g. started from background). */
    Function("start") { title: String, text: String ->
      val intent = Intent(context, KeepAliveService::class.java).apply {
        action = KeepAliveService.ACTION_START
        putExtra(KeepAliveService.EXTRA_TITLE, title)
        putExtra(KeepAliveService.EXTRA_TEXT, text)
      }
      try {
        ContextCompat.startForegroundService(context, intent)
      } catch (e: Exception) {
        throw CodedException("ERR_FGS_START", e.message ?: "Could not start foreground service", e)
      }
    }

    /** Updates the ongoing notification text without restarting the service. */
    Function("update") { title: String, text: String ->
      if (KeepAliveService.running) KeepAliveService.notify(context, title, text)
    }

    Function("stop") {
      if (KeepAliveService.running) {
        val intent = Intent(context, KeepAliveService::class.java).apply { action = KeepAliveService.ACTION_STOP }
        try {
          context.startService(intent)
        } catch (_: Exception) {
          context.stopService(Intent(context, KeepAliveService::class.java))
        }
      }
      Unit
    }

    Function("isRunning") { KeepAliveService.running }
  }
}
