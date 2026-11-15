package expo.modules.ultimacalls

import android.content.Context

/** Where the user wants call audio to go once a call is answered. */
object CallRoutePrefs {
  private const val FILE = "ultima_call_route"
  private const val KEY_MODE = "mode"
  private const val KEY_ADDRESS = "address"
  private const val KEY_NAME = "name"

  /** "auto" = leave Android's choice alone, "phone" = handset earpiece, "device" = a specific Bluetooth device. */
  const val MODE_AUTO = "auto"
  const val MODE_PHONE = "phone"
  const val MODE_DEVICE = "device"

  data class Pref(val mode: String, val address: String?, val name: String?)

  fun read(context: Context): Pref {
    val p = context.getSharedPreferences(FILE, Context.MODE_PRIVATE)
    return Pref(p.getString(KEY_MODE, MODE_AUTO) ?: MODE_AUTO, p.getString(KEY_ADDRESS, null), p.getString(KEY_NAME, null))
  }

  fun write(context: Context, mode: String, address: String?, name: String?) {
    context.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit()
      .putString(KEY_MODE, mode)
      .putString(KEY_ADDRESS, address)
      .putString(KEY_NAME, name)
      .apply()
  }
}
