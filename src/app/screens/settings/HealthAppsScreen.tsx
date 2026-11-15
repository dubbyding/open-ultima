import React from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Button, Switch, Text } from 'react-native-paper';

import { M3 } from '../../../domains/shared/theme/tokens.ts';
import { openHealthConnectInStore, stravaAthleteName, STRAVA_REDIRECT_URI } from '../../../domains/healthSync/index.ts';
import type { HealthSyncSnapshot, HealthTarget, HealthTargetId } from '../../../domains/healthSync/index.ts';
import { useApp } from '../../AppContext.tsx';
import { Banner, Card, HStack, IconBadge, Muted, Screen, SectionLabel, timeAgo, useTask } from '../../ui.tsx';
import type { Tone } from '../../ui.tsx';

const META: Record<HealthTargetId, { icon: string; tone: Tone; what: string }> = {
  healthConnect: {
    icon: 'heart-pulse',
    tone: 'emerald',
    what: 'Steps, distance, calories, all-day heart rate, sleep stages and workouts with routes. Google Fit and other Android health apps read from here.',
  },
  appleHealth: {
    icon: 'heart-outline',
    tone: 'rose',
    what: 'Steps, distance, heart rate and workouts. Each day is added once it’s over.',
  },
  strava: {
    icon: 'run-fast',
    tone: 'amber',
    what: 'Workouts recorded on your watch, with the GPS route when there is one.',
  },
};

type Availability = Awaited<ReturnType<HealthTarget['availability']>>;

function useHealthSyncSnapshot(): HealthSyncSnapshot {
  const { healthSync } = useApp();
  const [snap, setSnap] = React.useState(() => healthSync.snapshot());
  React.useEffect(() => {
    void healthSync.load();
    return healthSync.subscribe(() => setSnap(healthSync.snapshot()));
  }, [healthSync]);
  return snap;
}

function TargetCard({ target, state }: { target: HealthTarget; state: HealthSyncSnapshot['targets'][HealthTargetId] }): React.ReactElement {
  const { healthSync } = useApp();
  const { run, busy } = useTask();
  const [avail, setAvail] = React.useState<Availability | null>(null);
  const [account, setAccount] = React.useState<string | null>(null);
  const meta = META[target.id];

  const refresh = React.useCallback(() => {
    target.availability().then(setAvail, (e: unknown) => setAvail({ ok: false, reason: String(e) }));
    if (target.id === 'strava') void stravaAthleteName().then(setAccount);
  }, [target]);
  useFocusEffect(refresh);

  const toggle = (next: boolean): void =>
    void run(
      `toggle-${target.id}`,
      async () => {
        await healthSync.setEnabled(target.id, next);
        refresh();
      },
      { success: next ? `${target.name} is on` : `${target.name} is off`, failure: next ? `Couldn’t turn on ${target.name}` : `Couldn’t turn off ${target.name}` },
    );

  const syncNow = (): void =>
    void run(
      `sync-${target.id}`,
      async () => {
        await healthSync.sync(target.id);
      },
      { success: 'Up to date', failure: 'Couldn’t sync' },
    );

  const last = state.lastSyncAt ? timeAgo(Date.parse(state.lastSyncAt)) : null;
  const unavailable = avail && !avail.ok ? avail : null;

  return (
    <Card>
      <HStack align="flex-start">
        <IconBadge icon={meta.icon} tone={meta.tone} size={44} />
        <View style={styles.flex1}>
          <Text variant="titleMedium" style={styles.title}>
            {target.name}
          </Text>
          <Muted>{meta.what}</Muted>
        </View>
        <Switch
          value={state.enabled}
          disabled={Boolean(unavailable) || busy(`toggle-${target.id}`)}
          onValueChange={toggle}
          color={M3.primary}
        />
      </HStack>

      {unavailable ? (
        <View style={styles.block}>
          <Banner tone="amber" icon="information-outline" text={unavailable.reason} />
          {unavailable.action === 'install' ? (
            <Button mode="contained-tonal" icon="google-play" onPress={openHealthConnectInStore} style={styles.button}>
              Get Health Connect
            </Button>
          ) : null}
          {target.id === 'strava' && unavailable.action === 'configure' ? (
            <Muted>
              Create an app at strava.com/settings/api with callback domain “localhost”, then set EXPO_PUBLIC_STRAVA_CLIENT_ID and
              EXPO_PUBLIC_STRAVA_CLIENT_SECRET. Redirect: {STRAVA_REDIRECT_URI}
            </Muted>
          ) : null}
        </View>
      ) : null}

      {state.enabled ? (
        <View style={styles.block}>
          {account ? <Muted>Signed in as {account}</Muted> : null}
          <Muted>
            {state.syncing || busy(`sync-${target.id}`)
              ? 'Syncing…'
              : last
                ? `Last synced ${last}${state.lastCount > 0 ? ` · ${state.lastCount} new` : ''}`
                : 'Not synced yet'}
          </Muted>
          {state.lastError ? <Banner tone="rose" icon="alert-circle-outline" text={state.lastError} /> : null}
          <Button
            mode="outlined"
            icon="sync"
            onPress={syncNow}
            loading={state.syncing || busy(`sync-${target.id}`)}
            disabled={state.syncing || busy(`sync-${target.id}`)}
            style={styles.button}
          >
            Sync now
          </Button>
        </View>
      ) : null}
    </Card>
  );
}

export function HealthAppsScreen(): React.ReactElement {
  const { healthSync } = useApp();
  const snap = useHealthSyncSnapshot();
  const targets = healthSync.list();

  return (
    <Screen>
      <Muted>
        Copy what your watch records into the health apps you use. Data goes straight from this phone to the app you pick — new
        readings are sent automatically after each watch sync.
      </Muted>
      <SectionLabel>{Platform.OS === 'ios' ? 'On this iPhone' : 'On this phone'}</SectionLabel>
      {targets
        .filter((t) => t.id !== 'strava')
        .map((t) => (
          <TargetCard key={t.id} target={t} state={snap.targets[t.id]} />
        ))}
      <SectionLabel>Online</SectionLabel>
      {targets
        .filter((t) => t.id === 'strava')
        .map((t) => (
          <TargetCard key={t.id} target={t} state={snap.targets[t.id]} />
        ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex1: { flex: 1, gap: 4 },
  title: { color: M3.onSurface },
  block: { marginTop: 12, gap: 8 },
  button: { alignSelf: 'flex-start' },
});
