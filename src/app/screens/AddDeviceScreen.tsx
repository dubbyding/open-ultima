import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { ActivityIndicator, Button, Icon, Text } from 'react-native-paper';

import { M3 } from '../../domains/shared/theme/tokens.ts';
import { getCallAudioDevices } from '../../domains/calls/callRouting.ts';
import type { CallAudioDevice } from '../../domains/calls/callRouting.ts';
import type { DiscoveredDevice } from '../../services/bleManager.ts';
import { useApp, useConnectedIds } from '../AppContext.tsx';
import { Banner, Card, HStack, IconBadge, Muted, Row, RowGroup, Screen, SectionLabel, useTask } from '../ui.tsx';

function signalIcon(rssi: number): string {
  if (rssi >= -60) return 'signal-cellular-3';
  if (rssi >= -75) return 'signal-cellular-2';
  if (rssi >= -90) return 'signal-cellular-1';
  return 'signal-cellular-outline';
}

function signalLabel(rssi: number): string {
  if (rssi >= -60) return 'Very close';
  if (rssi >= -75) return 'Nearby';
  return 'Far away';
}

export function AddDeviceScreen(): React.ReactElement {
  const { snapshot, manager } = useApp();
  const navigation = useNavigation();
  const connectedIds = useConnectedIds();
  const { run, busy } = useTask();
  const [scannedOnce, setScannedOnce] = React.useState(false);

  const scan = React.useCallback(() => {
    void run('scan', async () => {
      await manager.startScan();
      setScannedOnce(true);
    }, { failure: 'Couldn’t search for devices' });
  }, [manager, run]);

  React.useEffect(() => {
    scan();
    return () => manager.stopScan();
    // Scan once when the page opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Earbuds already paired in Android's Bluetooth settings usually stop advertising
  // while they're connected for audio, so list them straight from the system.
  const [bonded, setBonded] = React.useState<CallAudioDevice[]>([]);
  useFocusEffect(
    React.useCallback(() => {
      try {
        setBonded(getCallAudioDevices().filter((d) => d.kind !== 'watch'));
      } catch {
        setBonded([]);
      }
    }, []),
  );

  const sorted = [...snapshot.discovered].sort((a, b) => b.rssi - a.rssi);
  const seenMacs = new Set(
    sorted.flatMap((d) => [d.id, d.mac, d.edrMac]).filter((m): m is string => !!m).map((m) => m.toLowerCase()),
  );
  const paired = bonded.filter((b) => !seenMacs.has(b.address.toLowerCase()) || connectedIds.has(b.address));
  const earbuds = sorted.filter((d) => d.kind === 'earbuds' && !paired.some((p) => p.address === d.id));
  const watches = sorted.filter((d) => d.kind === 'watch');
  const scanning = snapshot.scanning || busy('scan');

  const connect = (device: DiscoveredDevice): void => {
    void run(`c-${device.id}`, async () => {
      manager.stopScan();
      await manager.connectDevice(device.id);
      navigation.goBack();
    }, { success: `${device.name} connected`, failure: `Couldn’t connect to ${device.name}` });
  };

  const connectPaired = (d: CallAudioDevice): void => {
    void run(`c-${d.address}`, async () => {
      manager.stopScan();
      await manager.connectPairedEarbuds(d.address, d.name);
      navigation.goBack();
    }, {
      success: `${d.name} connected`,
      failure: `Couldn’t reach ${d.name}. Take them out of the case, keep them close and try again.`,
    });
  };

  const renderPaired = (d: CallAudioDevice): React.ReactElement => {
    const connected = connectedIds.has(d.address);
    const connecting = busy(`c-${d.address}`);
    return (
      <Row
        key={d.address}
        icon="earbuds"
        tone="cyan"
        title={d.name}
        subtitle={connected ? 'Connected' : 'Paired with this phone'}
        onPress={connected || connecting ? undefined : () => connectPaired(d)}
        right={
          connecting ? (
            <ActivityIndicator color={M3.primary} />
          ) : connected ? (
            <Icon source="check-circle" size={24} color={M3.primary} />
          ) : (
            <Button mode="contained-tonal" compact onPress={() => connectPaired(d)}>
              Connect
            </Button>
          )
        }
      />
    );
  };

  const renderDevice = (d: DiscoveredDevice): React.ReactElement => {
    const connected = connectedIds.has(d.id);
    const connecting = busy(`c-${d.id}`);
    return (
      <Row
        key={d.id}
        icon={d.kind === 'earbuds' ? 'earbuds' : 'watch-variant'}
        tone={d.kind === 'earbuds' ? 'cyan' : 'indigo'}
        title={d.productName ?? d.product?.name ?? d.name}
        subtitle={connected ? 'Connected' : signalLabel(d.rssi)}
        onPress={connected || connecting ? undefined : () => connect(d)}
        right={
          connecting ? (
            <ActivityIndicator color={M3.primary} />
          ) : connected ? (
            <Icon source="check-circle" size={24} color={M3.primary} />
          ) : (
            <HStack gap={8}>
              <Icon source={signalIcon(d.rssi)} size={18} color={M3.onSurfaceVariant} />
              <Button mode="contained-tonal" compact onPress={() => connect(d)}>
                Connect
              </Button>
            </HStack>
          )
        }
      />
    );
  };

  return (
    <Screen>
      {!snapshot.bleAvailable ? (
        <Banner tone="rose" icon="bluetooth-off" text="Turn on Bluetooth and allow Nearby devices to search." />
      ) : null}

      <Card>
        <HStack>
          <IconBadge icon="bluetooth-audio" size={48} />
          <View style={styles.flex1}>
            <Text variant="titleMedium" style={styles.title}>
              {scanning ? 'Looking for devices…' : 'Ready to search'}
            </Text>
            <Muted>Keep your devices within a metre of your phone.</Muted>
          </View>
          {scanning ? <ActivityIndicator color={M3.primary} /> : null}
        </HStack>
        <View style={styles.steps}>
          <Step n={1} text="Earbuds: open the charging case with the earbuds inside." />
          <Step n={2} text="Watch: wake the screen so it can be found." />
          <Step n={3} text="Tap Connect next to your device." />
        </View>
        <Button
          mode={scanning ? 'outlined' : 'contained'}
          icon={scanning ? 'stop' : 'magnify'}
          onPress={scanning ? () => manager.stopScan() : scan}
          contentStyle={styles.buttonContent}
          style={styles.scanButton}
        >
          {scanning ? 'Stop searching' : scannedOnce ? 'Search again' : 'Search'}
        </Button>
      </Card>

      {paired.length > 0 ? (
        <>
          <SectionLabel>Paired with this phone</SectionLabel>
          <RowGroup>{paired.map(renderPaired)}</RowGroup>
        </>
      ) : null}
      {earbuds.length > 0 ? (
        <>
          <SectionLabel>Earbuds</SectionLabel>
          <RowGroup>{earbuds.map(renderDevice)}</RowGroup>
        </>
      ) : null}
      {watches.length > 0 ? (
        <>
          <SectionLabel>Watches</SectionLabel>
          <RowGroup>{watches.map(renderDevice)}</RowGroup>
        </>
      ) : null}
      {scannedOnce && !scanning && sorted.length === 0 && paired.length === 0 ? (
        <Card>
          <Text variant="titleMedium" style={styles.title}>
            Nothing found
          </Text>
          <Muted>
            Make sure the device is charged and not connected to another phone. If it was paired before, remove it in
            that phone’s Bluetooth settings, then search again.
          </Muted>
        </Card>
      ) : null}
    </Screen>
  );
}

function Step({ n, text }: { n: number; text: string }): React.ReactElement {
  return (
    <HStack align="flex-start" gap={12}>
      <View style={styles.stepNum}>
        <Text variant="labelLarge" style={styles.stepNumText}>
          {n}
        </Text>
      </View>
      <Text variant="bodyMedium" style={[styles.flex1, styles.title]}>
        {text}
      </Text>
    </HStack>
  );
}

const styles = StyleSheet.create({
  flex1: { flex: 1, gap: 2 },
  title: { color: M3.onSurface },
  steps: { gap: 12, marginTop: 20 },
  stepNum: { width: 24, height: 24, borderRadius: 12, backgroundColor: M3.surfaceContainerHighest, alignItems: 'center', justifyContent: 'center' },
  stepNumText: { color: M3.onSurface },
  scanButton: { marginTop: 20 },
  buttonContent: { height: 48 },
});
