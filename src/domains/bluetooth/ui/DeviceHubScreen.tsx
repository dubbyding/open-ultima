import React from 'react';
import { ScrollView } from 'react-native';

import { SHARED_LAYOUT_STYLES, useActionRunner } from '../../shared/theme/tokens.ts';
import type { ScreenProps } from '../../shared/theme/tokens.ts';
import { PairedAndMapSection, buildHubMapPins } from './PairedAndMapSection.tsx';
import { ScannerAndBannerSection } from './ScannerAndBannerSection.tsx';

export { buildHubMapPins };

/** Hub tab screen orchestrating mode switching, simultaneous BLE connections, scanning, and offline pins. */
export function DeviceHubScreen({
  snapshot,
  manager,
  store,
  storeState,
  onStoreChanged,
}: ScreenProps): React.ReactElement {
  const actions = useActionRunner();
  const { earbuds, watch } = snapshot;

  const connectedIds = new Set<string>();
  if (earbuds.connected && earbuds.deviceId) connectedIds.add(earbuds.deviceId);
  if (watch.connected && watch.deviceId) connectedIds.add(watch.deviceId);

  return (
    <ScrollView
      style={SHARED_LAYOUT_STYLES.scroll}
      contentContainerStyle={SHARED_LAYOUT_STYLES.content}
      keyboardShouldPersistTaps="handled"
    >
      <ScannerAndBannerSection
        snapshot={snapshot}
        manager={manager}
        actions={actions}
        connectedIds={connectedIds}
      />
      <PairedAndMapSection
        snapshot={snapshot}
        manager={manager}
        store={store}
        storeState={storeState}
        actions={actions}
        connectedIds={connectedIds}
        onStoreChanged={onStoreChanged}
      />
    </ScrollView>
  );
}

export default DeviceHubScreen;
