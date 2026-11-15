import { PermissionsAndroid, Platform } from 'react-native';
import type { Permission } from 'react-native';

/**
 * Requests the runtime permissions Android needs before BLE scan/connect.
 * Android 12+ (API 31) uses BLUETOOTH_SCAN / BLUETOOTH_CONNECT; older
 * versions require fine location for BLE scanning. iOS prompts natively.
 */
export async function ensureBlePermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  const apiLevel = typeof Platform.Version === 'number' ? Platform.Version : Number(Platform.Version);
  const needed: Permission[] =
    apiLevel >= 31
      ? [
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        ]
      : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];
  const result = await PermissionsAndroid.requestMultiple(needed);
  const required = apiLevel >= 31 ? needed.slice(0, 2) : needed;
  return required.every((p) => result[p] === PermissionsAndroid.RESULTS.GRANTED);
}
