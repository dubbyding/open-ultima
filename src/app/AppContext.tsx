import React from 'react';

import type { ScreenProps } from '../domains/shared/theme/tokens.ts';

import type { HealthSyncManager } from '../domains/healthSync/index.ts';
import type { KeepAliveControls } from './useBackgroundKeepAlive.ts';

export interface AppContextValue extends ScreenProps {
  keepAlive: KeepAliveControls;
  healthSync: HealthSyncManager;
}

/** Live BLE snapshot + services shared by every page. */
export const AppContext = React.createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const value = React.useContext(AppContext);
  if (!value) throw new Error('useApp() must be used inside <AppContext.Provider>');
  return value;
}

/** Device ids currently holding a GATT connection. */
export function useConnectedIds(): ReadonlySet<string> {
  const { snapshot } = useApp();
  const { earbuds, watch } = snapshot;
  return React.useMemo(() => {
    const ids = new Set<string>();
    if (earbuds.connected && earbuds.deviceId) ids.add(earbuds.deviceId);
    if (watch.connected && watch.deviceId) ids.add(watch.deviceId);
    return ids;
  }, [earbuds.connected, earbuds.deviceId, watch.connected, watch.deviceId]);
}
