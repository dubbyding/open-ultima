/**
 * "Answer calls on" preference.
 *
 * Android: the local `modules/ultima-calls` module runs a non-UI InCallService
 * that moves call audio to the chosen device once a call is answered, even when
 * it was answered on the watch. Telecom only binds that service after the user
 * approves Android's one-time watch companion dialog (grants call control).
 *
 * iOS: apps can't route cellular call audio, so this is unavailable there.
 */
import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';

export type CallRouteMode = 'auto' | 'phone' | 'device';

export interface CallRoutePreference {
  mode: CallRouteMode;
  address: string | null;
  name: string | null;
}

export interface CallAudioDevice {
  address: string;
  name: string;
  kind: 'watch' | 'headset' | 'other';
}

export interface CallRoutingStatus {
  supported: boolean;
  /** Linked to a watch through Android's companion dialog. */
  associated: boolean;
  /** Android lets the app steer call audio. */
  callControlGranted: boolean;
}

interface UltimaCallsNative {
  isSupported(): boolean;
  getStatus(): CallRoutingStatus;
  getCallAudioDevices(): CallAudioDevice[];
  getPreference(): CallRoutePreference;
  setPreference(mode: CallRouteMode, address: string | null, name: string | null): void;
  associateWatch(address: string | null, name: string | null): Promise<boolean>;
  startFindSound?(): boolean;
  stopFindSound?(): void;
}

const native = Platform.OS === 'android' ? requireOptionalNativeModule<UltimaCallsNative>('UltimaCalls') : null;

export const callRoutingAvailable = native !== null && native.isSupported();

export function getCallRoutingStatus(): CallRoutingStatus {
  return native ? native.getStatus() : { supported: false, associated: false, callControlGranted: false };
}

export function getCallAudioDevices(): CallAudioDevice[] {
  return native ? native.getCallAudioDevices() : [];
}

export function getCallRoutePreference(): CallRoutePreference {
  return native ? native.getPreference() : { mode: 'auto', address: null, name: null };
}

export function setCallRoutePreference(pref: CallRoutePreference): void {
  native?.setPreference(pref.mode, pref.address, pref.name);
}

/** Opens Android's watch companion dialog. Resolves true if the user allowed it. */
export async function linkWatchForCalls(device: CallAudioDevice | null): Promise<boolean> {
  if (!native) throw new Error('Call routing needs Android 12 or newer.');
  return native.associateWatch(device?.address ?? null, device ? null : 'ultima');
}

/**
 * Loud repeating beep on the phone's media stream, which plays through the
 * connected earbuds — how Ultima Link implements "find my earbuds". Android only.
 */
export const findEarbudsSound: { start(): boolean; stop(): void } | undefined =
  native?.startFindSound && native.stopFindSound
    ? { start: () => native.startFindSound!(), stop: () => native.stopFindSound!() }
    : undefined;
