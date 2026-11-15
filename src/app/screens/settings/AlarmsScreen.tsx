import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Button, Switch, Text, TouchableRipple } from 'react-native-paper';

import { CRP_ALARM_REPEAT } from '../../../protocols/ultimaFitCrrepa.ts';
import { MAX_WATCH_ALARMS } from '../../../storage/offlineStore.ts';
import { M3 } from '../../../domains/shared/theme/tokens.ts';
import { useApp } from '../../AppContext.tsx';
import { Banner, EmptyState, Muted, RowGroup, Screen, useTask } from '../../ui.tsx';

const DAYS: readonly { short: string; bit: number }[] = [
  { short: 'Sun', bit: CRP_ALARM_REPEAT.SUNDAY },
  { short: 'Mon', bit: CRP_ALARM_REPEAT.MONDAY },
  { short: 'Tue', bit: CRP_ALARM_REPEAT.TUESDAY },
  { short: 'Wed', bit: CRP_ALARM_REPEAT.WEDNESDAY },
  { short: 'Thu', bit: CRP_ALARM_REPEAT.THURSDAY },
  { short: 'Fri', bit: CRP_ALARM_REPEAT.FRIDAY },
  { short: 'Sat', bit: CRP_ALARM_REPEAT.SATURDAY },
];

export function describeRepeat(mask: number): string {
  const days = DAYS.filter((d) => (mask & d.bit) !== 0).map((d) => d.short);
  if (days.length === 0) return 'Once';
  if (days.length === 7) return 'Every day';
  if (days.length === 5 && !days.includes('Sat') && !days.includes('Sun')) return 'Weekdays';
  if (days.length === 2 && days.includes('Sat') && days.includes('Sun')) return 'Weekends';
  return days.join(', ');
}

function pad2(n: number): string {
  return String(Math.max(0, Math.floor(n))).padStart(2, '0');
}

/** Alarm list with on/off switches; tap to edit. */
export function AlarmsScreen(): React.ReactElement {
  const navigation = useNavigation();
  const { snapshot, manager, onStoreChanged } = useApp();
  const { busy, run } = useTask();
  const watch = snapshot.watch;
  const connected = watch.connected;
  const alarms = [...watch.alarms].sort((a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute));
  const full = watch.alarms.length >= MAX_WATCH_ALARMS;

  const addAlarm = (): void => navigation.navigate('AlarmEdit', {});

  return (
    <View style={styles.flex}>
      <Screen>
        {!connected ? <Banner icon="watch-variant" text="Connect your watch to add or change alarms." /> : null}
        {alarms.length === 0 ? (
          <EmptyState
            icon="alarm"
            title="No alarms yet"
            body="Your watch can hold up to 8 alarms and vibrates when they go off."
            action={connected ? { label: 'Add alarm', icon: 'plus', onPress: addAlarm } : undefined}
          />
        ) : (
          <RowGroup>
            {alarms.map((alarm) => (
              <TouchableRipple
                key={alarm.id}
                onPress={() => navigation.navigate('AlarmEdit', { id: alarm.id })}
                disabled={!connected}
                accessibilityRole="button"
                accessibilityLabel={`Alarm ${pad2(alarm.hour)}:${pad2(alarm.minute)}, ${describeRepeat(alarm.repeatMask)}`}
              >
                <View style={styles.alarmRow}>
                  <View style={styles.flex}>
                    <Text variant="displaySmall" style={{ color: alarm.enabled ? M3.onSurface : M3.onSurfaceVariant }}>
                      {pad2(alarm.hour)}:{pad2(alarm.minute)}
                    </Text>
                    <Muted>{describeRepeat(alarm.repeatMask)}</Muted>
                  </View>
                  <Switch
                    value={alarm.enabled}
                    color={M3.primary}
                    disabled={!connected || busy(`alarm-${alarm.id}`)}
                    onValueChange={(enabled) =>
                      void run(
                        `alarm-${alarm.id}`,
                        async () => {
                          await manager.saveWatchAlarm({ ...alarm, enabled });
                          onStoreChanged();
                        },
                        { failure: 'Couldn’t update the alarm' },
                      )
                    }
                  />
                </View>
              </TouchableRipple>
            ))}
          </RowGroup>
        )}
        {full ? <Muted center>All 8 alarm slots are in use. Delete one to add another.</Muted> : null}
      </Screen>
      {alarms.length > 0 ? (
        <View style={styles.bottomBar}>
          <Button mode="contained" icon="plus" disabled={!connected || full} onPress={addAlarm} contentStyle={styles.buttonContent}>
            Add alarm
          </Button>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  alarmRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14, gap: 16 },
  bottomBar: { padding: 16, backgroundColor: M3.background },
  buttonContent: { height: 52 },
});
