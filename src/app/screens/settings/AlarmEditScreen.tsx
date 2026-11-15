import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import { Button, Dialog, IconButton, Portal, Text } from 'react-native-paper';

import { CRP_ALARM_REPEAT } from '../../../protocols/ultimaFitCrrepa.ts';
import { MAX_WATCH_ALARMS } from '../../../storage/offlineStore.ts';
import type { WatchAlarmRecord } from '../../../storage/offlineStore.ts';
import { M3 } from '../../../domains/shared/theme/tokens.ts';
import { useApp } from '../../AppContext.tsx';
import type { RootStackParamList } from '../../routes.ts';
import { Banner, Card, ChoiceTiles, HStack, Muted, Screen, SectionLabel, useTask } from '../../ui.tsx';
import type { Choice } from '../../ui.tsx';
import { describeRepeat } from './AlarmsScreen.tsx';

const DAYS: readonly { letter: string; name: string; bit: number }[] = [
  { letter: 'S', name: 'Sunday', bit: CRP_ALARM_REPEAT.SUNDAY },
  { letter: 'M', name: 'Monday', bit: CRP_ALARM_REPEAT.MONDAY },
  { letter: 'T', name: 'Tuesday', bit: CRP_ALARM_REPEAT.TUESDAY },
  { letter: 'W', name: 'Wednesday', bit: CRP_ALARM_REPEAT.WEDNESDAY },
  { letter: 'T', name: 'Thursday', bit: CRP_ALARM_REPEAT.THURSDAY },
  { letter: 'F', name: 'Friday', bit: CRP_ALARM_REPEAT.FRIDAY },
  { letter: 'S', name: 'Saturday', bit: CRP_ALARM_REPEAT.SATURDAY },
];

const WEEKDAYS =
  CRP_ALARM_REPEAT.MONDAY | CRP_ALARM_REPEAT.TUESDAY | CRP_ALARM_REPEAT.WEDNESDAY | CRP_ALARM_REPEAT.THURSDAY | CRP_ALARM_REPEAT.FRIDAY;

const QUICK: readonly Choice<number>[] = [
  { value: CRP_ALARM_REPEAT.SINGLE, label: 'Once' },
  { value: WEEKDAYS, label: 'Weekdays' },
  { value: CRP_ALARM_REPEAT.EVERYDAY, label: 'Every day' },
];

function pad2(n: number): string {
  return String(Math.max(0, Math.floor(n))).padStart(2, '0');
}

function wrap(value: number, max: number): number {
  return ((value % max) + max) % max;
}

function TimeColumn({
  label,
  value,
  onChange,
  step,
  max,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  step: number;
  max: number;
}): React.ReactElement {
  return (
    <View style={styles.timeColumn}>
      <IconButton icon="chevron-up" size={32} mode="contained-tonal" onPress={() => onChange(wrap(value + step, max))} accessibilityLabel={`Increase ${label}`} />
      <Text variant="displayLarge" style={styles.timeText} accessibilityLabel={`${label} ${value}`}>
        {pad2(value)}
      </Text>
      <IconButton icon="chevron-down" size={32} mode="contained-tonal" onPress={() => onChange(wrap(value - step, max))} accessibilityLabel={`Decrease ${label}`} />
    </View>
  );
}

/** Create or edit one of the watch's 8 alarm slots. */
export function AlarmEditScreen(): React.ReactElement {
  const navigation = useNavigation();
  const route = useRoute<RouteProp<RootStackParamList, 'AlarmEdit'>>();
  const { snapshot, manager, onStoreChanged } = useApp();
  const { busy, run } = useTask();
  const watch = snapshot.watch;
  const editingId = route.params?.id;
  const existing = editingId === undefined ? undefined : watch.alarms.find((a) => a.id === editingId);

  const freeSlot = React.useMemo(() => {
    const used = new Set(watch.alarms.map((a) => a.id));
    for (let i = 0; i < MAX_WATCH_ALARMS; i++) if (!used.has(i)) return i;
    return null;
  }, [watch.alarms]);
  const slot = existing?.id ?? freeSlot;

  const [hour, setHour] = React.useState(existing?.hour ?? 7);
  const [minute, setMinute] = React.useState(existing?.minute ?? 0);
  const [mask, setMask] = React.useState(existing?.repeatMask ?? WEEKDAYS);
  const [confirmDelete, setConfirmDelete] = React.useState(false);

  const save = (): void => {
    if (slot === null) return;
    const now = new Date();
    const record: WatchAlarmRecord = {
      id: slot,
      enabled: existing?.enabled ?? true,
      hour,
      minute,
      repeatMask: mask & CRP_ALARM_REPEAT.EVERYDAY,
      year: now.getFullYear(),
      month: now.getMonth() + 1,
      day: now.getDate(),
      label: existing?.label ?? `Alarm ${slot + 1}`,
    };
    void run(
      'save',
      async () => {
        await manager.saveWatchAlarm({ ...record, enabled: true });
        onStoreChanged();
      },
      { success: `Alarm set for ${pad2(hour)}:${pad2(minute)}`, failure: 'Couldn’t save the alarm' },
    ).then((ok) => {
      if (ok) navigation.goBack();
    });
  };

  const remove = (): void => {
    if (existing === undefined) return;
    setConfirmDelete(false);
    void run(
      'delete',
      async () => {
        await manager.deleteWatchAlarm(existing.id);
        onStoreChanged();
      },
      { success: 'Alarm deleted', failure: 'Couldn’t delete the alarm' },
    ).then((ok) => {
      if (ok) navigation.goBack();
    });
  };

  const connected = watch.connected;

  return (
    <Screen>
      {!connected ? <Banner icon="watch-variant" text="Connect your watch to save this alarm." /> : null}
      {slot === null ? <Banner tone="rose" icon="alert-circle-outline" text="All 8 alarm slots are in use. Delete an alarm first." /> : null}

      <Card>
        <HStack gap={8} style={styles.timeRow}>
          <TimeColumn label="hour" value={hour} onChange={setHour} step={1} max={24} />
          <Text variant="displayLarge" style={styles.timeText}>
            :
          </Text>
          <TimeColumn label="minute" value={minute} onChange={setMinute} step={5} max={60} />
        </HStack>
        <Muted center>Minutes change in steps of 5</Muted>
      </Card>

      <SectionLabel>Repeat</SectionLabel>
      <Card>
        <View style={styles.days}>
          {DAYS.map((d) => {
            const on = (mask & d.bit) !== 0;
            return (
              <Pressable
                key={d.name}
                onPress={() => setMask((m) => m ^ d.bit)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                accessibilityLabel={d.name}
                style={[styles.day, on ? styles.dayOn : null]}
              >
                <Text variant="titleMedium" style={{ color: on ? M3.onPrimary : M3.onSurface }}>
                  {d.letter}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Muted center>{describeRepeat(mask)}</Muted>
        <View style={styles.quick}>
          <ChoiceTiles options={QUICK} value={QUICK.some((q) => q.value === mask) ? mask : null} columns={3} onChange={setMask} />
        </View>
      </Card>

      <Button
        mode="contained"
        icon="check"
        onPress={save}
        loading={busy('save')}
        disabled={!connected || slot === null || busy('save')}
        contentStyle={styles.buttonContent}
        style={styles.saveButton}
      >
        Save alarm
      </Button>
      {existing ? (
        <Button mode="text" textColor={M3.error} icon="delete-outline" onPress={() => setConfirmDelete(true)} disabled={!connected || busy('delete')}>
          Delete alarm
        </Button>
      ) : null}

      <Portal>
        <Dialog visible={confirmDelete} onDismiss={() => setConfirmDelete(false)}>
          <Dialog.Title>Delete this alarm?</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium">
              The {pad2(hour)}:{pad2(minute)} alarm will be removed from your watch.
            </Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setConfirmDelete(false)}>Cancel</Button>
            <Button textColor={M3.error} onPress={remove}>
              Delete
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  timeRow: { justifyContent: 'center' },
  timeColumn: { alignItems: 'center' },
  timeText: { color: M3.onSurface, fontVariant: ['tabular-nums'] },
  days: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  day: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: M3.surfaceContainerHighest },
  dayOn: { backgroundColor: M3.primary },
  quick: { marginTop: 12 },
  buttonContent: { height: 52 },
  saveButton: { marginTop: 16 },
});
