import React from 'react';
import { StyleSheet } from 'react-native';
import { Button, Text } from 'react-native-paper';

import { M3 } from '../../../domains/shared/theme/tokens.ts';
import { useApp } from '../../AppContext.tsx';
import { Banner, Card, Gap, IconBadge, Muted, Row, RowGroup, Screen, SectionLabel, timeAgo, useTask } from '../../ui.tsx';
import { EarbudsNotConnectedBanner, useSavedEarbuds } from './EarbudsScreen.tsx';

export function FindEarbudsScreen(): React.ReactElement {
  const { snapshot, manager } = useApp();
  const { run, busy } = useTask();
  const saved = useSavedEarbuds();
  const earbuds = snapshot.earbuds;
  const connected = earbuds.connected;
  const ringing = earbuds.finding || earbuds.findingActive;
  const location = earbuds.lastKnownLocation ?? saved?.lastKnownLocation ?? null;

  return (
    <Screen>
      <EarbudsNotConnectedBanner />

      <Card>
        <IconBadge icon={ringing ? 'volume-high' : 'earbuds'} tone={ringing ? 'amber' : 'cyan'} size={64} />
        <Gap size={12} />
        <Text variant="titleLarge" style={styles.onSurface}>
          {ringing ? 'Playing sound…' : 'Play a sound'}
        </Text>
        <Muted>
          {ringing
            ? 'Follow the sound to find your earbuds. Tap Stop when you’ve found them.'
            : 'Your earbuds will play a loud tone so you can find them nearby.'}
        </Muted>
        <Gap size={16} />
        <Button
          mode="contained"
          icon={ringing ? 'stop' : 'volume-high'}
          buttonColor={ringing ? M3.error : undefined}
          textColor={ringing ? M3.onError : undefined}
          disabled={!connected}
          loading={busy('find')}
          contentStyle={styles.bigButton}
          onPress={() => void run('find', () => manager.findEarbuds(!ringing), { failure: ringing ? 'Couldn’t stop the sound' : 'Couldn’t play the sound' })}
        >
          {ringing ? 'Stop sound' : 'Play sound'}
        </Button>
      </Card>

      <Banner tone="rose" icon="alert-outline" text="Take the earbuds out of your ears first — the sound is loud." />

      <SectionLabel>Last seen</SectionLabel>
      <RowGroup>
        {location ? (
          <Row
            icon="map-marker-outline"
            tone="amber"
            title={location.note || 'Last place they were connected'}
            subtitle={timeAgo(location.savedAt) ?? undefined}
          />
        ) : (
          <Row
            icon="map-marker-off-outline"
            tone="neutral"
            title="No location saved yet"
            subtitle={connected ? 'Your earbuds are connected and should be within Bluetooth range.' : 'If they’re out of range, try where you last used them.'}
          />
        )}
      </RowGroup>
    </Screen>
  );
}

const styles = StyleSheet.create({
  onSurface: { color: M3.onSurface },
  bigButton: { height: 56 },
});
