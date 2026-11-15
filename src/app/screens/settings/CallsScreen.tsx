import React from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Button, Icon, Text } from 'react-native-paper';

import { M3 } from '../../../domains/shared/theme/tokens.ts';
import {
  callRoutingAvailable,
  getCallAudioDevices,
  getCallRoutePreference,
  getCallRoutingStatus,
  linkWatchForCalls,
  setCallRoutePreference,
} from '../../../domains/calls/callRouting.ts';
import type { CallAudioDevice, CallRoutePreference, CallRoutingStatus } from '../../../domains/calls/callRouting.ts';
import { useApp } from '../../AppContext.tsx';
import { Banner, Card, EmptyState, HStack, IconBadge, Muted, Row, RowGroup, Screen, SectionLabel, useFeedback, useTask } from '../../ui.tsx';

/** Human label for the saved preference, used by the Settings row too. */
export function describeCallRoute(pref: CallRoutePreference): string {
  if (pref.mode === 'phone') return 'Phone';
  if (pref.mode === 'device') return pref.name ?? 'Bluetooth device';
  return 'Wherever you answer';
}

function deviceIcon(d: CallAudioDevice, earbudsName: string): string {
  if (d.kind === 'watch') return 'watch-variant';
  if (earbudsName && d.name.toLowerCase() === earbudsName.toLowerCase()) return 'earbuds';
  return d.kind === 'headset' ? 'headphones' : 'bluetooth';
}

export function CallsScreen(): React.ReactElement {
  const { snapshot } = useApp();
  const { show } = useFeedback();
  const { run, busy } = useTask();
  const [status, setStatus] = React.useState<CallRoutingStatus>(() => getCallRoutingStatus());
  const [pref, setPref] = React.useState<CallRoutePreference>(() => getCallRoutePreference());
  const [devices, setDevices] = React.useState<CallAudioDevice[]>([]);

  const reload = React.useCallback(() => {
    setStatus(getCallRoutingStatus());
    setPref(getCallRoutePreference());
    try {
      setDevices(getCallAudioDevices());
    } catch {
      setDevices([]);
    }
  }, []);

  useFocusEffect(reload);

  if (!callRoutingAvailable) {
    return (
      <Screen>
        <EmptyState
          icon="phone-off"
          title="Not available on this phone"
          body={
            Platform.OS === 'ios'
              ? 'iPhone doesn’t let apps choose where call audio plays. During a call, tap the audio button on the call screen.'
              : 'Choosing the call device needs Android 12 or newer.'
          }
        />
      </Screen>
    );
  }

  const choose = (next: CallRoutePreference): void => {
    setCallRoutePreference(next);
    setPref(next);
    show(`Calls will play on: ${describeCallRoute(next)}`);
  };

  const watchName = (snapshot.watch.name || '').trim().toLowerCase();
  // Only real watches: Bluetooth class "wearable", or exactly the watch's name. (Matching on a
  // shared brand word like "Ultima" wrongly picked the earbuds.)
  const watchCandidates = devices.filter((d) => d.kind === 'watch' || (watchName !== '' && d.name.trim().toLowerCase() === watchName));
  // Ultima watches talk to the phone over Bluetooth LE only, so they usually aren't in this list.
  // Android's call-control approval works with any paired device, so use the one picked for calls.
  const chosenDevice = pref.mode === 'device' ? devices.find((d) => d.address.toLowerCase() === pref.address?.toLowerCase()) : undefined;
  const linkTarget = watchCandidates[0] ?? chosenDevice ?? devices[0] ?? null;
  const needsPermission = pref.mode !== 'auto' && !status.callControlGranted;

  const link = (device: CallAudioDevice | null): void => {
    void run(
      'link',
      async () => {
        const ok = await linkWatchForCalls(device);
        reload();
        if (!ok) throw new Error('You didn’t allow it');
      },
      { success: 'Call control allowed', failure: 'Couldn’t allow call control' },
    );
  };

  const selected = (mode: CallRoutePreference['mode'], address: string | null = null): boolean =>
    pref.mode === mode && (mode !== 'device' || pref.address?.toLowerCase() === address?.toLowerCase());

  const check = (on: boolean): React.ReactNode =>
    on ? <Icon source="check-circle" size={24} color={M3.primary} /> : <Icon source="circle-outline" size={24} color={M3.outline} />;

  return (
    <Screen>
      <Card>
        <HStack align="flex-start">
          <IconBadge icon="phone-in-talk" tone="emerald" size={48} />
          <View style={styles.flex1}>
            <Text variant="titleMedium" style={styles.title}>
              Pick where you hear calls
            </Text>
            <Muted>
              When you answer a call — on your phone, watch or earbuds — the audio switches to the device you pick here, if
              it’s connected. You can still switch during a call from the call screen.
            </Muted>
          </View>
        </HStack>
      </Card>

      {needsPermission ? (
        <Card tone="amber">
          <Text variant="titleMedium" style={styles.title}>
            One more step
          </Text>
          <Muted>
            {watchCandidates.length > 0
              ? 'Android only lets a watch’s companion app move call audio. Link your watch once — Android will ask you to confirm.'
              : `Android needs you to allow call control once. Your watch connects over Bluetooth LE and isn’t in Android’s paired list, so Android will ask using ${linkTarget ? linkTarget.name : 'a paired device'} instead — that’s expected.`}
          </Muted>
          {watchCandidates.length > 1 ? (
            <View style={styles.linkList}>
              {watchCandidates.map((d) => (
                <Button key={d.address} mode="contained" icon="watch-variant" onPress={() => link(d)} loading={busy('link')} disabled={busy('link')}>
                  Link {d.name}
                </Button>
              ))}
            </View>
          ) : (
            <Button
              mode="contained"
              icon="link-variant"
              style={styles.linkButton}
              contentStyle={styles.buttonContent}
              loading={busy('link')}
              disabled={busy('link')}
              onPress={() => link(linkTarget)}
            >
              {watchCandidates[0] ? `Link ${watchCandidates[0].name}` : 'Allow call control'}
            </Button>
          )}
        </Card>
      ) : null}

      {pref.mode !== 'auto' && status.callControlGranted ? (
        <Banner tone="emerald" icon="check-circle-outline" text="Ready. The next call you answer will use this setting." />
      ) : null}

      <SectionLabel>Answer calls on</SectionLabel>
      <RowGroup>
        <Row
          icon="gesture-tap"
          tone="neutral"
          title="Wherever I answer"
          subtitle="Android’s default — audio stays on the device you answered with"
          onPress={() => choose({ mode: 'auto', address: null, name: null })}
          right={check(selected('auto'))}
        />
        <Row
          icon="cellphone"
          tone="neutral"
          title="Phone"
          subtitle="Hold the phone to your ear"
          onPress={() => choose({ mode: 'phone', address: null, name: null })}
          right={check(selected('phone'))}
        />
        {devices.map((d) => (
          <Row
            key={d.address}
            icon={deviceIcon(d, snapshot.earbuds.name)}
            tone={d.kind === 'watch' ? 'indigo' : 'cyan'}
            title={d.name}
            subtitle={d.kind === 'watch' ? 'Watch speaker and mic' : 'Bluetooth headset'}
            onPress={() => choose({ mode: 'device', address: d.address, name: d.name })}
            right={check(selected('device', d.address))}
          />
        ))}
      </RowGroup>
      {devices.length === 0 ? (
        <Muted center>
          No Bluetooth audio devices are paired with this phone yet. Pair your earbuds in Android’s Bluetooth settings first.
        </Muted>
      ) : (
        <Muted center>Only devices paired in Android’s Bluetooth settings appear here.</Muted>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex1: { flex: 1, gap: 4 },
  title: { color: M3.onSurface },
  linkList: { gap: 8, marginTop: 12 },
  linkButton: { marginTop: 12 },
  buttonContent: { height: 48 },
});
