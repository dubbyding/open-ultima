import React from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import type { BleManagerSnapshot, KeeperLinkStatus, UltimaBleManager } from '../services/bleManager.ts';
import {
  ensureNotificationPermission,
  startBackgroundKeepAlive,
  stopBackgroundKeepAlive,
} from '../domains/bluetooth/backgroundKeepAlive.ts';

const PREF_KEY = 'ultima.keepAlive.enabled';

export interface KeepAliveControls {
  enabled: boolean;
  setEnabled: (next: boolean) => void;
}

function describeLink(label: string, link: KeeperLinkStatus, connected: boolean): string | null {
  if (connected) return `${label} connected`;
  switch (link.state) {
    case 'reconnecting':
      return `${label} reconnecting…`;
    case 'waiting':
      return `${label} out of range`;
    default:
      return null;
  }
}

/**
 * Owns the "stay connected in background" preference: runs the manager's
 * keep-alive loop and, on Android, the foreground service that keeps it alive.
 */
export function useBackgroundKeepAlive(
  manager: UltimaBleManager,
  snapshot: BleManagerSnapshot,
): KeepAliveControls {
  const [enabled, setEnabledState] = React.useState(true);
  const [prefLoaded, setPrefLoaded] = React.useState(false);

  React.useEffect(() => {
    AsyncStorage.getItem(PREF_KEY)
      .then((v) => { if (v === 'false') setEnabledState(false); })
      .catch(() => undefined)
      .finally(() => setPrefLoaded(true));
  }, []);

  const setEnabled = React.useCallback((next: boolean) => {
    setEnabledState(next);
    AsyncStorage.setItem(PREF_KEY, String(next)).catch(() => undefined);
    if (next) void ensureNotificationPermission();
  }, []);

  // Keep-alive loop: only once the offline store (saved devices) is loaded.
  const ready = prefLoaded && snapshot.initialized;
  React.useEffect(() => {
    if (!ready) return;
    if (enabled) manager.startKeepAlive();
    else manager.stopKeepAlive();
  }, [ready, enabled, manager]);

  // Re-check links whenever the app comes back to the foreground.
  React.useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') manager.pokeKeepAlive();
    });
    return () => sub.remove();
  }, [manager]);

  // Foreground service + notification text mirrors link state.
  const { keepAlive, earbuds, watch } = snapshot;
  const lines = [
    describeLink('Earbuds', keepAlive.earbuds, earbuds.connected),
    describeLink('Watch', keepAlive.watch, watch.connected),
  ].filter((l): l is string => l !== null);
  const hasTargets = lines.length > 0;
  const text = lines.join(' · ');

  React.useEffect(() => {
    if (!ready) return;
    if (enabled && keepAlive.enabled && hasTargets) {
      startBackgroundKeepAlive('Keeping your devices connected', text);
    } else {
      stopBackgroundKeepAlive();
    }
  }, [ready, enabled, keepAlive.enabled, hasTargets, text]);

  React.useEffect(() => () => stopBackgroundKeepAlive(), []);

  React.useEffect(() => {
    if (ready && enabled) void ensureNotificationPermission();
  }, [ready, enabled]);

  return React.useMemo(() => ({ enabled, setEnabled }), [enabled, setEnabled]);
}
