import React from 'react';
import { StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Button, Dialog, Portal, Text, TextInput } from 'react-native-paper';

import { M3 } from '../../../domains/shared/theme/tokens.ts';
import { useApp } from '../../AppContext.tsx';
import { Card, Gap, Row, RowGroup, Screen, SectionLabel, useTask } from '../../ui.tsx';
import { EarbudsNotConnectedBanner, useSavedEarbuds } from './EarbudsScreen.tsx';

type Confirm = 'forget' | 'reset' | null;

export function EarbudsAboutScreen(): React.ReactElement {
  const { snapshot, manager, store, onStoreChanged } = useApp();
  const navigation = useNavigation();
  const { run, busy } = useTask();
  const saved = useSavedEarbuds();
  const earbuds = snapshot.earbuds;
  const connected = earbuds.connected;
  const currentName = earbuds.name || earbuds.deviceName || saved?.name || 'Earbuds';
  const [name, setName] = React.useState(currentName);
  const [confirm, setConfirm] = React.useState<Confirm>(null);

  React.useEffect(() => {
    setName(currentName);
  }, [currentName]);

  const deviceId = earbuds.deviceId ?? saved?.id ?? null;
  const firmware = earbuds.firmwareVersion?.trim();
  const address = earbuds.mac ?? saved?.mac ?? null;

  const forget = (): void => {
    setConfirm(null);
    void run(
      'forget',
      async () => {
        if (connected) await manager.disconnectEarbuds();
        if (deviceId) await store.removePairedDevice(deviceId);
        onStoreChanged();
        navigation.goBack();
      },
      { success: 'Earbuds forgotten', failure: 'Couldn’t forget earbuds' },
    );
  };

  const reset = (): void => {
    setConfirm(null);
    void run('reset', () => manager.factoryResetEarbuds(), { success: 'Earbuds reset to factory settings', failure: 'Couldn’t reset earbuds' });
  };

  return (
    <Screen>
      <EarbudsNotConnectedBanner />

      <SectionLabel>Name</SectionLabel>
      <Card>
        <TextInput mode="outlined" label="Earbuds name" value={name} onChangeText={setName} disabled={!connected} maxLength={30} />
        <Gap size={12} />
        <Button
          mode="contained-tonal"
          disabled={!connected || !name.trim() || name.trim() === currentName}
          loading={busy('rename')}
          contentStyle={styles.button}
          onPress={() => void run('rename', () => manager.renameEarbuds(name.trim()), { success: 'Name saved', failure: 'Couldn’t rename' })}
        >
          Save name
        </Button>
        <Gap size={4} />
        <Text variant="bodySmall" style={styles.muted}>
          This is the name other phones see in Bluetooth settings.
        </Text>
      </Card>

      <SectionLabel>Details</SectionLabel>
      <RowGroup>
        <Row icon="earbuds-outline" title="Model" right={earbuds.product?.name ?? 'Ultima earbuds'} />
        <Row icon="chip" tone="indigo" title="Firmware" right={firmware || 'Unknown'} />
        {address ? <Row icon="bluetooth" tone="neutral" title="Bluetooth address" subtitle={address} /> : null}
      </RowGroup>

      <SectionLabel>Manage</SectionLabel>
      <RowGroup>
        {connected ? (
          <Row
            icon="link-variant-off"
            tone="neutral"
            title="Disconnect"
            subtitle="They’ll stay saved and won’t reconnect until you connect again"
            disabled={busy('disconnect')}
            onPress={() => void run('disconnect', () => manager.disconnectEarbuds(), { success: 'Earbuds disconnected', failure: 'Couldn’t disconnect' })}
          />
        ) : null}
        {deviceId ? (
          <Row icon="delete-outline" danger title="Forget earbuds" subtitle="Remove them from this app" onPress={() => setConfirm('forget')} />
        ) : null}
        <Row
          icon="restore-alert"
          danger
          title="Reset to factory settings"
          subtitle="Restores sound, noise control and touch controls"
          disabled={!connected}
          onPress={() => setConfirm('reset')}
        />
      </RowGroup>

      <Portal>
        <Dialog visible={confirm !== null} onDismiss={() => setConfirm(null)} style={styles.dialog}>
          <Dialog.Icon icon={confirm === 'reset' ? 'restore-alert' : 'delete-outline'} />
          <Dialog.Title style={styles.center}>{confirm === 'reset' ? 'Reset earbuds?' : 'Forget earbuds?'}</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium" style={styles.muted}>
              {confirm === 'reset'
                ? 'All your sound, noise control and touch control settings on the earbuds will be erased.'
                : `${currentName} will be removed from this app. You can add them again later.`}
            </Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setConfirm(null)}>Cancel</Button>
            <Button textColor={M3.error} onPress={confirm === 'reset' ? reset : forget}>
              {confirm === 'reset' ? 'Reset' : 'Forget'}
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  muted: { color: M3.onSurfaceVariant },
  button: { height: 48 },
  dialog: { backgroundColor: M3.surfaceContainerHigh },
  center: { textAlign: 'center' },
});
