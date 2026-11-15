import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Button, Dialog, Portal, Text } from 'react-native-paper';

import type { PairedDeviceRecord } from '../../../storage/offlineStore.ts';
import { M3 } from '../../../domains/shared/theme/tokens.ts';
import { useApp } from '../../AppContext.tsx';
import { Card, EmptyState, HStack, IconBadge, Muted, Pill, Screen, timeAgo, useTask } from '../../ui.tsx';

/** Saved earbuds and watches: connect, disconnect, forget. */
export function DevicesScreen(): React.ReactElement {
  const navigation = useNavigation();
  const { snapshot, manager, store, storeState, onStoreChanged } = useApp();
  const { busy, run } = useTask();
  const [forgetTarget, setForgetTarget] = React.useState<PairedDeviceRecord | null>(null);
  const devices = [...storeState.pairedDevices].sort((a, b) => b.lastConnectedAt - a.lastConnectedAt);

  const live = (d: PairedDeviceRecord): { connected: boolean; connecting: boolean } => {
    const s = d.kind === 'earbuds' ? snapshot.earbuds : snapshot.watch;
    const mine = s.deviceId === d.id;
    return { connected: mine && s.connected, connecting: mine && s.connecting };
  };

  const forget = (d: PairedDeviceRecord): void => {
    setForgetTarget(null);
    void run(
      `forget-${d.id}`,
      async () => {
        if (live(d).connected) {
          if (d.kind === 'earbuds') await manager.disconnectEarbuds();
          else await manager.disconnectWatch();
        }
        await store.removePairedDevice(d.id);
        onStoreChanged();
      },
      { success: `${d.name} removed`, failure: 'Couldn’t remove the device' },
    );
  };

  return (
    <Screen>
      {devices.length === 0 ? (
        <EmptyState
          icon="devices"
          title="No saved devices"
          body="Devices you connect are remembered here so the app can reconnect to them automatically."
          action={{ label: 'Add a device', icon: 'plus', onPress: () => navigation.navigate('AddDevice') }}
        />
      ) : (
        <>
          {devices.map((d) => {
            const { connected, connecting } = live(d);
            const key = `conn-${d.id}`;
            return (
              <Card key={d.id}>
                <HStack gap={16}>
                  <IconBadge icon={d.kind === 'earbuds' ? 'earbuds' : 'watch-variant'} tone={d.kind === 'earbuds' ? 'cyan' : 'indigo'} size={48} />
                  <View style={styles.flex}>
                    <Text variant="titleMedium" style={styles.title} numberOfLines={1}>
                      {d.name}
                    </Text>
                    <Muted>
                      {d.kind === 'earbuds' ? 'Earbuds' : 'Watch'}
                      {connected ? '' : ` · Last connected ${timeAgo(d.lastConnectedAt) ?? 'never'}`}
                    </Muted>
                  </View>
                  {connected ? <Pill label="Connected" tone="emerald" /> : connecting ? <Pill label="Connecting" tone="amber" /> : null}
                </HStack>
                <HStack gap={8} style={styles.actions}>
                  {connected ? (
                    <Button
                      mode="contained-tonal"
                      icon="link-variant-off"
                      loading={busy(key)}
                      disabled={busy(key)}
                      onPress={() =>
                        void run(key, () => (d.kind === 'earbuds' ? manager.disconnectEarbuds() : manager.disconnectWatch()), {
                          failure: 'Couldn’t disconnect',
                        })
                      }
                    >
                      Disconnect
                    </Button>
                  ) : (
                    <Button
                      mode="contained"
                      icon="bluetooth-connect"
                      loading={busy(key) || connecting}
                      disabled={busy(key) || connecting}
                      onPress={() =>
                        void run(key, () => manager.connectDevice(d.id), {
                          success: `${d.name} connected`,
                          failure: `Couldn’t connect to ${d.name}`,
                        })
                      }
                    >
                      Connect
                    </Button>
                  )}
                  <Button mode="text" textColor={M3.error} disabled={busy(`forget-${d.id}`)} onPress={() => setForgetTarget(d)}>
                    Forget
                  </Button>
                </HStack>
              </Card>
            );
          })}
          <Button mode="outlined" icon="plus" onPress={() => navigation.navigate('AddDevice')} contentStyle={styles.buttonContent} style={styles.add}>
            Add a device
          </Button>
        </>
      )}

      <Portal>
        <Dialog visible={forgetTarget !== null} onDismiss={() => setForgetTarget(null)}>
          <Dialog.Title>Forget {forgetTarget?.name}?</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium">The app will stop reconnecting to it. You can add it again later.</Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setForgetTarget(null)}>Cancel</Button>
            <Button textColor={M3.error} onPress={() => forgetTarget && forget(forgetTarget)}>
              Forget
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  title: { color: M3.onSurface },
  actions: { marginTop: 16 },
  add: { marginTop: 8 },
  buttonContent: { height: 52 },
});
