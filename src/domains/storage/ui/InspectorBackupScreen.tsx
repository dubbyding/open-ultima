import React from 'react';
import { ScrollView } from 'react-native';

import { SHARED_LAYOUT_STYLES, useActionRunner } from '../../shared/theme/tokens.ts';
import type { ScreenProps } from '../../shared/theme/tokens.ts';
import { PacketInspectorSection } from './PacketInspectorSection.tsx';
import { SqliteAndBackupSection } from './SqliteAndBackupSection.tsx';

/** Inspector tab screen combining live BLE packet inspector, SQLite diagnostics, and offline backup. */
export function InspectorBackupScreen({
  snapshot,
  manager,
  store,
  storeState,
  onStoreChanged,
}: ScreenProps): React.ReactElement {
  const actions = useActionRunner();

  return (
    <ScrollView
      style={SHARED_LAYOUT_STYLES.scroll}
      contentContainerStyle={SHARED_LAYOUT_STYLES.content}
      keyboardShouldPersistTaps="handled"
    >
      <PacketInspectorSection snapshot={snapshot} manager={manager} actions={actions} />
      <SqliteAndBackupSection
        store={store}
        storeState={storeState}
        actions={actions}
        onStoreChanged={onStoreChanged}
      />
    </ScrollView>
  );
}

export default InspectorBackupScreen;
