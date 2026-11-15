import React from 'react';
import { getCallRoutePreference } from '../../../domains/calls/callRouting.ts';
import { describeCallRoute } from './CallsScreen.tsx';
import { Platform, StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { backgroundKeepAliveSupported } from '../../../domains/bluetooth/backgroundKeepAlive.ts';
import { useApp } from '../../AppContext.tsx';
import { Muted, Row, RowGroup, Screen, SectionLabel, SwitchRow, Spinner, useTask } from '../../ui.tsx';

const NOT_CONNECTED = 'Watch not connected';

function keepAliveSubtitle(): string {
  if (!backgroundKeepAliveSupported) return 'Needs a newer build of Ultima Open on this phone.';
  return Platform.OS === 'ios'
    ? 'Reconnects automatically when your earbuds or watch come back in range, even with the app closed.'
    : 'Reconnects automatically. Android shows a small ongoing notification while this is on.';
}

/** Settings tab: watch, connection, data and developer entry points. */
export function SettingsScreen(): React.ReactElement {
  const navigation = useNavigation();
  const { snapshot, manager, keepAlive } = useApp();
  const { busy, run } = useTask();
  const watch = snapshot.watch;
  const connected = watch.connected;
  const s = watch.settings;

  const watchSummary = [
    `Watch face ${s.watchFaceId}`,
    s.is24Hour ? '24-hour' : '12-hour',
    `Raise to wake ${s.quickView ? 'on' : 'off'}`,
  ].join(' · ');
  const alarmsOn = watch.alarms.filter((a) => a.enabled).length;
  const alarmsSubtitle =
    watch.alarms.length === 0 ? 'No alarms' : `${alarmsOn} of ${watch.alarms.length} alarm${watch.alarms.length === 1 ? '' : 's'} on`;

  return (
    <Screen>
      <SectionLabel>Watch</SectionLabel>
      <RowGroup>
        <Row
          icon="watch-variant"
          title="Watch settings"
          subtitle={connected ? watchSummary : `${watchSummary} · ${NOT_CONNECTED}`}
          right="chevron"
          onPress={() => navigation.navigate('WatchSettings')}
        />
        <Row icon="alarm" tone="amber" title="Alarms" subtitle={alarmsSubtitle} right="chevron" onPress={() => navigation.navigate('Alarms')} />
        <Row
          icon="bell-ring-outline"
          tone="indigo"
          title="Notifications"
          subtitle={connected ? 'Send a test notification to your watch' : NOT_CONNECTED}
          right="chevron"
          disabled={!connected}
          onPress={() => navigation.navigate('WatchNotifications')}
        />
        <Row
          icon="clock-check-outline"
          tone="emerald"
          title="Sync time now"
          subtitle={connected ? 'Set the watch clock to this phone’s time' : NOT_CONNECTED}
          disabled={!connected || busy('time')}
          right={busy('time') ? <Spinner /> : null}
          onPress={() => void run('time', () => manager.syncWatchTime(), { success: 'Watch time updated', failure: 'Couldn’t sync the time' })}
        />
        <Row
          icon="vibrate"
          tone="rose"
          title="Find my watch"
          subtitle={connected ? 'Make your watch vibrate' : NOT_CONNECTED}
          disabled={!connected || busy('find')}
          right={busy('find') ? <Spinner /> : null}
          onPress={() => void run('find', () => manager.findWatch(), { success: 'Your watch is vibrating', failure: 'Couldn’t reach your watch' })}
        />
      </RowGroup>

      <SectionLabel>Connection</SectionLabel>
      <RowGroup>
        <SwitchRow
          icon="bluetooth-connect"
          title="Stay connected in background"
          subtitle={keepAliveSubtitle()}
          value={keepAlive.enabled}
          disabled={!backgroundKeepAliveSupported}
          onValueChange={keepAlive.setEnabled}
        />
        <Row
          icon="phone-in-talk"
          tone="emerald"
          title="Calls"
          subtitle={`Answer calls on: ${describeCallRoute(getCallRoutePreference())}`}
          right="chevron"
          onPress={() => navigation.navigate('Calls')}
        />
        <Row
          icon="devices"
          tone="indigo"
          title="My devices"
          subtitle={`${snapshot.storeState.pairedDevices.length} saved on this phone`}
          right="chevron"
          onPress={() => navigation.navigate('Devices')}
        />
      </RowGroup>

      <SectionLabel>Data</SectionLabel>
      <RowGroup>
        <Row
          icon="heart-pulse"
          tone="rose"
          title="Health apps"
          subtitle={Platform.OS === 'ios' ? 'Apple Health and Strava' : 'Health Connect (Google) and Strava'}
          right="chevron"
          onPress={() => navigation.navigate('HealthApps')}
        />
        <Row
          icon="google-spreadsheet"
          tone="emerald"
          title="Google Sheets"
          subtitle="Copy everything to a spreadsheet in your Drive"
          right="chevron"
          onPress={() => navigation.navigate('GoogleSheets')}
        />
        <Row
          icon="cloud-upload-outline"
          tone="emerald"
          title="Backup & data"
          subtitle="Export, restore or erase what’s stored on this phone"
          right="chevron"
          onPress={() => navigation.navigate('Backup')}
        />
      </RowGroup>

      <SectionLabel>Developer</SectionLabel>
      <RowGroup>
        <Row
          icon="swap-vertical"
          tone="neutral"
          title="Packet log"
          subtitle={`${snapshot.packetLogs.length} messages captured`}
          right="chevron"
          onPress={() => navigation.navigate('PacketLog')}
        />
        <Row icon="database-outline" tone="neutral" title="Database" subtitle="Storage tables and totals" right="chevron" onPress={() => navigation.navigate('Database')} />
      </RowGroup>

      <View style={styles.footer}>
        <Muted center>Ultima Open · works offline, no account</Muted>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  footer: { marginTop: 24 },
});
