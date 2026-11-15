/**
 * Platform glue that keeps the BLE keep-alive loop running in the background.
 *
 * Android: a `connectedDevice` foreground service (local module
 * `modules/ultima-keepalive`) holds the process at foreground priority and shows
 * an ongoing notification, as Android requires.
 *
 * iOS: there is no foreground service. The `bluetooth-central` background mode
 * plus Core Bluetooth state restoration let iOS wake the app for BLE events, and
 * reconnects are issued as pending connects that iOS completes when the device
 * is back in range — so these calls are no-ops there.
 */
import { PermissionsAndroid, Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';

interface UltimaKeepAliveNative {
  start(title: string, text: string): void;
  update(title: string, text: string): void;
  stop(): void;
  isRunning(): boolean;
}

const native = Platform.OS === 'android' ? requireOptionalNativeModule<UltimaKeepAliveNative>('UltimaKeepAlive') : null;

/** True when this build can keep links alive while backgrounded. */
export const backgroundKeepAliveSupported = Platform.OS === 'ios' || native !== null;

/** Android 13+ needs POST_NOTIFICATIONS for the ongoing notification to be visible. */
export async function ensureNotificationPermission(): Promise<void> {
  if (Platform.OS !== 'android' || Number(Platform.Version) < 33) return;
  try {
    await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
  } catch {
    // The service still runs without it; the notification is just hidden.
  }
}

/** Starts or refreshes the Android foreground service. Returns false if the OS refused. */
export function startBackgroundKeepAlive(title: string, text: string): boolean {
  if (!native) return Platform.OS === 'ios';
  try {
    if (native.isRunning()) native.update(title, text);
    else native.start(title, text);
    return true;
  } catch (err) {
    console.warn('[UltimaKeepAlive] foreground service not started:', err instanceof Error ? err.message : err);
    return false;
  }
}

export function stopBackgroundKeepAlive(): void {
  try {
    native?.stop();
  } catch {
    // already stopped
  }
}
