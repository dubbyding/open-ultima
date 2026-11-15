package expo.modules.ultimacalls

import android.annotation.SuppressLint
import android.bluetooth.BluetoothDevice
import android.os.Handler
import android.os.Looper
import android.telecom.Call
import android.telecom.CallAudioState
import android.telecom.InCallService
import android.util.Log

/**
 * Moves call audio to the user's preferred device after a call is answered —
 * including when the call was answered on the watch, which would otherwise keep
 * the audio on the watch.
 *
 * Only acts while a call is ACTIVE, and at most a few times per call so it never
 * fights a manual switch the user makes from the dialer during the call.
 */
class CallAudioRouterService : InCallService() {
  private val handler = Handler(Looper.getMainLooper())
  private val attemptsByCall = HashMap<Call, Int>()
  /** After the user (or another app) moves audio away from our target this long after answering, stop correcting. */
  private val correctionWindowMs = 8_000L
  private val activeSince = HashMap<Call, Long>()

  private val callback = object : Call.Callback() {
    override fun onStateChanged(call: Call, state: Int) {
      if (state == Call.STATE_ACTIVE) {
        activeSince.putIfAbsent(call, System.currentTimeMillis())
        // Bluetooth SCO setup takes a moment after answering; route now and re-check shortly after.
        route("answered")
        handler.postDelayed({ route("answered+0.8s") }, 800)
        handler.postDelayed({ route("answered+2.5s") }, 2_500)
      }
    }
  }

  override fun onCallAdded(call: Call) {
    call.registerCallback(callback)
    if (call.details.state == Call.STATE_ACTIVE) callback.onStateChanged(call, Call.STATE_ACTIVE)
  }

  override fun onCallRemoved(call: Call) {
    call.unregisterCallback(callback)
    attemptsByCall.remove(call)
    activeSince.remove(call)
  }

  @Deprecated("Still the only route-change callback available on API 31–33")
  override fun onCallAudioStateChanged(audioState: CallAudioState?) {
    route("audio-state")
  }

  private fun activeCall(): Call? = calls.firstOrNull { it.details.state == Call.STATE_ACTIVE }

  @SuppressLint("MissingPermission")
  @Suppress("DEPRECATION")
  private fun route(reason: String) {
    val call = activeCall() ?: return
    val pref = CallRoutePrefs.read(this)
    if (pref.mode == CallRoutePrefs.MODE_AUTO) return

    val since = activeSince[call] ?: return
    if (System.currentTimeMillis() - since > correctionWindowMs) return
    val attempts = attemptsByCall[call] ?: 0
    if (attempts >= 4) return

    val state = callAudioState ?: return
    when (pref.mode) {
      CallRoutePrefs.MODE_PHONE -> {
        if (state.route == CallAudioState.ROUTE_BLUETOOTH) {
          attemptsByCall[call] = attempts + 1
          Log.i(TAG, "[$reason] moving call audio to phone earpiece")
          setAudioRoute(CallAudioState.ROUTE_WIRED_OR_EARPIECE)
        }
      }
      CallRoutePrefs.MODE_DEVICE -> {
        val target = findTarget(state.supportedBluetoothDevices, pref) ?: return // not connected: leave Android's choice
        val onTarget = state.route == CallAudioState.ROUTE_BLUETOOTH && state.activeBluetoothDevice?.address == target.address
        if (onTarget) return
        attemptsByCall[call] = attempts + 1
        Log.i(TAG, "[$reason] moving call audio to ${target.address}")
        requestBluetoothAudio(target)
      }
    }
  }

  @SuppressLint("MissingPermission")
  private fun findTarget(devices: Collection<BluetoothDevice>, pref: CallRoutePrefs.Pref): BluetoothDevice? {
    pref.address?.let { addr -> devices.firstOrNull { it.address.equals(addr, ignoreCase = true) }?.let { return it } }
    val name = pref.name ?: return null
    return devices.firstOrNull { d -> runCatching { d.name }.getOrNull()?.equals(name, ignoreCase = true) == true }
  }

  companion object {
    private const val TAG = "UltimaCallRouter"
  }
}
