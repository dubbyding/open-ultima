package expo.modules.ultimacalls

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.bluetooth.BluetoothClass
import android.bluetooth.BluetoothManager
import android.companion.AssociationRequest
import android.companion.BluetoothDeviceFilter
import android.companion.CompanionDeviceManager
import android.content.Context
import android.content.IntentSender
import android.content.pm.PackageManager
import android.media.AudioManager
import android.media.ToneGenerator
import android.os.Handler
import android.os.Looper
import android.os.Build
import android.os.ParcelUuid
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.regex.Pattern

private const val REQUEST_ASSOCIATE = 41_07
private val HFP_UUID: ParcelUuid = ParcelUuid.fromString("0000111e-0000-1000-8000-00805f9b34fb")
private val HSP_UUID: ParcelUuid = ParcelUuid.fromString("00001108-0000-1000-8000-00805f9b34fb")

class UltimaCallsModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw CodedException("ERR_NO_CONTEXT", "React context unavailable", null)

  private var pendingAssociation: Promise? = null

  /** Settles the pending association promise once; ignores one that is already settled. */
  private fun settleAssociation(block: (Promise) -> Unit) {
    val p = pendingAssociation ?: return
    pendingAssociation = null
    runCatching { block(p) }
  }

  // --- "Find my earbuds": loud beeps on the media stream, which plays through the
  // connected earbuds (same approach as Ultima Link's find.wav player). ---
  private val findHandler = Handler(Looper.getMainLooper())
  private var findTone: ToneGenerator? = null
  private var findRestoreVolume = -1
  private val findLoop = object : Runnable {
    override fun run() {
      findTone?.startTone(ToneGenerator.TONE_PROP_BEEP2, 500)
      findHandler.postDelayed(this, 700)
    }
  }
  private val findAutoStop = Runnable { stopFind() }

  private fun startFind(): Boolean {
    if (findTone != null) return true
    val am = context.getSystemService(AudioManager::class.java) ?: return false
    findRestoreVolume = am.getStreamVolume(AudioManager.STREAM_MUSIC)
    runCatching { am.setStreamVolume(AudioManager.STREAM_MUSIC, am.getStreamMaxVolume(AudioManager.STREAM_MUSIC), 0) }
    findTone = runCatching { ToneGenerator(AudioManager.STREAM_MUSIC, ToneGenerator.MAX_VOLUME) }.getOrNull() ?: return false
    findHandler.post(findLoop)
    findHandler.postDelayed(findAutoStop, 60_000)
    return true
  }

  private fun stopFind() {
    findHandler.removeCallbacks(findLoop)
    findHandler.removeCallbacks(findAutoStop)
    findTone?.stopTone()
    findTone?.release()
    findTone = null
    if (findRestoreVolume >= 0) {
      val am = context.getSystemService(AudioManager::class.java)
      runCatching { am?.setStreamVolume(AudioManager.STREAM_MUSIC, findRestoreVolume, 0) }
      findRestoreVolume = -1
    }
  }

  override fun definition() = ModuleDefinition {
    Name("UltimaCalls")

    /** Android 12+ is required for the watch companion profile that grants call control. */
    Function("isSupported") { Build.VERSION.SDK_INT >= Build.VERSION_CODES.S }

    Function("getStatus") {
      val supported = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
      mapOf(
        "supported" to supported,
        "associated" to (supported && hasAssociation()),
        "callControlGranted" to (supported && callControlGranted()),
      )
    }

    /** Paired (bonded) Bluetooth devices that can carry call audio. */
    Function("getCallAudioDevices") { listCallAudioDevices() }

    Function("startFindSound") { startFind() }
    Function("stopFindSound") { stopFind() }

    Function("getPreference") {
      val p = CallRoutePrefs.read(context)
      mapOf("mode" to p.mode, "address" to p.address, "name" to p.name)
    }

    Function("setPreference") { mode: String, address: String?, name: String? ->
      val safeMode = when (mode) {
        CallRoutePrefs.MODE_PHONE, CallRoutePrefs.MODE_DEVICE -> mode
        else -> CallRoutePrefs.MODE_AUTO
      }
      CallRoutePrefs.write(context, safeMode, address, name)
    }

    /**
     * Shows Android's one-time "Allow Ultima Open to manage <watch>?" dialog
     * (CompanionDeviceManager, watch profile). Accepting grants call control.
     * Resolves true when the user approved.
     */
    AsyncFunction("associateWatch") { address: String?, name: String?, promise: Promise ->
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
        promise.reject(CodedException("ERR_UNSUPPORTED", "Needs Android 12 or newer", null))
        return@AsyncFunction
      }
      val activity = appContext.currentActivity
      if (activity == null) {
        promise.reject(CodedException("ERR_NO_ACTIVITY", "App is not in the foreground", null))
        return@AsyncFunction
      }
      startAssociation(activity, address, name, promise)
    }

    OnActivityResult { _, payload ->
      if (payload.requestCode == REQUEST_ASSOCIATE) {
        settleAssociation { it.resolve(payload.resultCode == Activity.RESULT_OK) }
      }
    }
  }

  /**
   * MANAGE_ONGOING_CALLS is an app-op permission: the companion watch role turns the op on,
   * but checkSelfPermission keeps reporting it as denied. Check the op and the role too.
   */
  @SuppressLint("NewApi")
  private fun callControlGranted(): Boolean {
    if (context.checkSelfPermission(Manifest.permission.MANAGE_ONGOING_CALLS) == PackageManager.PERMISSION_GRANTED) return true
    val opAllowed = runCatching {
      val ops = context.getSystemService(android.app.AppOpsManager::class.java)
      ops.unsafeCheckOpNoThrow("android:manage_ongoing_calls", android.os.Process.myUid(), context.packageName) ==
        android.app.AppOpsManager.MODE_ALLOWED
    }.getOrDefault(false)
    if (opAllowed) return true
    return runCatching {
      context.getSystemService(android.app.role.RoleManager::class.java).isRoleHeld("android.app.role.COMPANION_DEVICE_WATCH")
    }.getOrDefault(false)
  }

  @Suppress("DEPRECATION")
  private fun hasAssociation(): Boolean {
    val cdm = context.getSystemService(CompanionDeviceManager::class.java) ?: return false
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) cdm.myAssociations.isNotEmpty() else cdm.associations.isNotEmpty()
  }

  @SuppressLint("MissingPermission")
  private fun listCallAudioDevices(): List<Map<String, Any?>> {
    val adapter = context.getSystemService(BluetoothManager::class.java)?.adapter ?: return emptyList()
    val bonded = runCatching { adapter.bondedDevices }.getOrNull() ?: return emptyList()
    return bonded.mapNotNull { d ->
      val major = runCatching { d.bluetoothClass?.majorDeviceClass }.getOrNull()
      val uuids = runCatching { d.uuids?.toList() }.getOrNull().orEmpty()
      val carriesCalls = uuids.contains(HFP_UUID) || uuids.contains(HSP_UUID) ||
        major == BluetoothClass.Device.Major.AUDIO_VIDEO || major == BluetoothClass.Device.Major.WEARABLE
      if (!carriesCalls) return@mapNotNull null
      mapOf(
        "address" to d.address,
        "name" to (runCatching { d.name }.getOrNull() ?: d.address),
        "kind" to when (major) {
          BluetoothClass.Device.Major.WEARABLE -> "watch"
          BluetoothClass.Device.Major.AUDIO_VIDEO -> "headset"
          else -> "other"
        },
      )
    }
  }

  @SuppressLint("NewApi")
  private fun startAssociation(activity: Activity, address: String?, name: String?, promise: Promise) {
    // Must come from the Activity: on Android 12/13 associate() casts its context to Activity.
    val cdm = activity.getSystemService(CompanionDeviceManager::class.java)
    if (cdm == null || !context.packageManager.hasSystemFeature(PackageManager.FEATURE_COMPANION_DEVICE_SETUP)) {
      promise.reject(CodedException("ERR_UNSUPPORTED", "This phone doesn't support companion devices", null))
      return
    }
    val filter = BluetoothDeviceFilter.Builder().apply {
      if (!address.isNullOrBlank()) setAddress(address)
      else if (!name.isNullOrBlank()) setNamePattern(Pattern.compile(".*" + Pattern.quote(name) + ".*", Pattern.CASE_INSENSITIVE))
    }.build()
    val request = AssociationRequest.Builder()
      .addDeviceFilter(filter)
      .setSingleDevice(!address.isNullOrBlank())
      .setDeviceProfile(AssociationRequest.DEVICE_PROFILE_WATCH)
      .build()

    settleAssociation { it.reject(CodedException("ERR_SUPERSEDED", "Another request started", null)) }
    pendingAssociation = promise

    val launch = { sender: IntentSender ->
      try {
        activity.startIntentSenderForResult(sender, REQUEST_ASSOCIATE, null, 0, 0, 0)
      } catch (e: Exception) {
        settleAssociation { it.reject(CodedException("ERR_LAUNCH", e.message ?: "Could not open the pairing dialog", e)) }
      }
    }

    cdm.associate(request, object : CompanionDeviceManager.Callback() {
      @Deprecated("Replaced by onAssociationPending on API 33+")
      override fun onDeviceFound(chooserLauncher: IntentSender) = launch(chooserLauncher)

      override fun onAssociationPending(intentSender: IntentSender) = launch(intentSender)

      override fun onFailure(error: CharSequence?) {
        if (pendingAssociation === promise) {
          settleAssociation { it.reject(CodedException("ERR_ASSOCIATE", error?.toString() ?: "Device not found", null)) }
        }
      }
    }, null)
  }
}
