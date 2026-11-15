import React from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { CRP_ALARM_REPEAT } from '../../../protocols/ultimaFitCrrepa.ts';
import { MAX_WATCH_ALARMS } from '../../../storage/offlineStore.ts';
import type { WatchAlarmRecord } from '../../../storage/offlineStore.ts';
import type {
  BleManagerSnapshot,
  UltimaBleManager,
} from '../../../services/bleManager.ts';
import {
  ActionChip,
  Card,
  PrimaryButton,
  SectionHeader,
  Stepper,
  ToggleRow,
} from '../../shared/theme/primitives.tsx';
import {
  COLORS,
  RADII,
  SHARED_LAYOUT_STYLES,
  SPACING,
  TYPOGRAPHY,
  clampNumber,
  hex8,
} from '../../shared/theme/tokens.ts';
import type { AccentTone, ActionRunner } from '../../shared/theme/tokens.ts';

export interface AlarmsNotifySettingsSectionProps {
  watch: BleManagerSnapshot['watch'];
  manager: UltimaBleManager;
  actions: ActionRunner;
  onStoreChanged: () => void;
}

const WEEKDAY_BITS: readonly { label: string; bit: number }[] = [
  { label: 'Sun', bit: CRP_ALARM_REPEAT.SUNDAY },
  { label: 'Mon', bit: CRP_ALARM_REPEAT.MONDAY },
  { label: 'Tue', bit: CRP_ALARM_REPEAT.TUESDAY },
  { label: 'Wed', bit: CRP_ALARM_REPEAT.WEDNESDAY },
  { label: 'Thu', bit: CRP_ALARM_REPEAT.THURSDAY },
  { label: 'Fri', bit: CRP_ALARM_REPEAT.FRIDAY },
  { label: 'Sat', bit: CRP_ALARM_REPEAT.SATURDAY },
];

const GOAL_PRESETS: readonly number[] = [6000, 8000, 10000, 12000, 15000];
const HR_INTERVAL_OPTIONS: readonly number[] = [0, 5, 10, 15, 30, 60];
const WATCH_FACES: readonly number[] = [1, 2, 3, 4, 5, 6];

function pad2(value: number): string {
  return String(Math.max(0, Math.floor(value))).padStart(2, '0');
}

/** Renders watch settings and 8-slot CRREPA 0xB9 alarm manager. */
export function AlarmsNotifySettingsSection({
  watch,
  manager,
  actions,
  onStoreChanged,
}: AlarmsNotifySettingsSectionProps): React.ReactElement {
  const connected = watch.connected;
  const settings = watch.settings;
  const drink = settings.drinkReminderPeriod;

  const [selectedSlot, setSelectedSlot] = React.useState<number>(0);
  const existingSlotAlarm = watch.alarms.find((a) => a.id === selectedSlot);
  const [alarmHour, setAlarmHour] = React.useState<number>(existingSlotAlarm?.hour ?? 7);
  const [alarmMinute, setAlarmMinute] = React.useState<number>(existingSlotAlarm?.minute ?? 30);
  const [alarmEnabled, setAlarmEnabled] = React.useState<boolean>(existingSlotAlarm?.enabled ?? true);
  const [alarmRepeatMask, setAlarmRepeatMask] = React.useState<number>(
    existingSlotAlarm?.repeatMask ?? CRP_ALARM_REPEAT.EVERYDAY,
  );
  const [alarmLabel, setAlarmLabel] = React.useState<string>(
    existingSlotAlarm?.label ?? 'Morning Workout',
  );

  React.useEffect(() => {
    const slotAlarm = watch.alarms.find((a) => a.id === selectedSlot);
    if (slotAlarm) {
      setAlarmHour(slotAlarm.hour);
      setAlarmMinute(slotAlarm.minute);
      setAlarmEnabled(slotAlarm.enabled);
      setAlarmRepeatMask(slotAlarm.repeatMask);
      setAlarmLabel(slotAlarm.label);
    }
  }, [selectedSlot, watch.alarms]);

  const runSettingMutation = (label: string, op: () => Promise<void>): void => {
    actions.run(label, async () => {
      await op();
      onStoreChanged();
    });
  };

  const watchToggles: ReadonlyArray<{
    label: string;
    subtitle: string;
    value: boolean;
    badge?: string;
    tone: AccentTone;
    onChange: (next: boolean) => void;
  }> = [
    {
      label: '24-Hour Time Format',
      subtitle: 'Toggle between 24h (military) and 12h AM/PM display (CMD 0x17)',
      value: settings.is24Hour,
      badge: settings.is24Hour ? '24H' : '12H',
      tone: 'cyan',
      onChange: (next) =>
        runSettingMutation(`Time format -> ${next ? '24h' : '12h'}`, () =>
          manager.setWatchTimeFormat(next),
        ),
    },
    {
      label: 'Quick View (Raise Wrist to Wake)',
      subtitle: 'Wake watch display automatically on wrist rotation (CMD 0x18)',
      value: settings.quickView,
      tone: 'emerald',
      onChange: (next) =>
        runSettingMutation(`Quick View ${next ? 'ON' : 'OFF'}`, () =>
          manager.setWatchQuickView(next),
        ),
    },
    {
      label: 'Imperial Distance Units (Miles)',
      subtitle: 'Off = Metric (km/cm), On = Imperial (mi/in) (CMD 0x1A)',
      value: settings.imperialUnits,
      badge: settings.imperialUnits ? 'MI' : 'KM',
      tone: 'amber',
      onChange: (next) =>
        runSettingMutation(`Units -> ${next ? 'Imperial' : 'Metric'}`, () =>
          manager.setWatchUnits(next),
        ),
    },
    {
      label: 'Sedentary Activity Reminder',
      subtitle: 'Hourly vibration alert when inactive (CMD 0x26)',
      value: settings.sedentaryReminder,
      tone: 'indigo',
      onChange: (next) =>
        runSettingMutation(`Sedentary Reminder ${next ? 'ON' : 'OFF'}`, () =>
          manager.setWatchSedentaryReminder(next),
        ),
    },
  ];

  const handleSaveAlarmSlot = (): void => {
    const now = new Date();
    const record: WatchAlarmRecord = {
      id: clampNumber(selectedSlot, 0, MAX_WATCH_ALARMS - 1),
      enabled: alarmEnabled,
      hour: clampNumber(alarmHour, 0, 23),
      minute: clampNumber(alarmMinute, 0, 59),
      repeatMask: clampNumber(alarmRepeatMask, 0, 0x7f),
      year: now.getFullYear(),
      month: now.getMonth() + 1,
      day: now.getDate(),
      label: alarmLabel.trim() || `Alarm #${selectedSlot + 1}`,
    };
    runSettingMutation(`Save Alarm Slot #${selectedSlot}`, () => manager.saveWatchAlarm(record));
  };

  return (
    <>
      <SectionHeader
        style={SHARED_LAYOUT_STYLES.sectionGap}
        overline="Watch Configuration"
        title="Goals, Dial, Units & Reminders"
        subtitle="Synchronized with watch GATT characteristics and persisted to OfflineStore"
        right={
          <ActionChip
            label="Sync Time (0x31)"
            compact
            tone="cyan"
            disabled={!connected}
            onPress={() => actions.run('Sync Watch Time', () => manager.syncWatchTime())}
          />
        }
      />
      <Card>
        <Text style={TYPOGRAPHY.overline}>Daily Step Goal</Text>
        <View style={SHARED_LAYOUT_STYLES.chipWrap}>
          {GOAL_PRESETS.map((steps) => (
            <ActionChip
              key={steps}
              label={`${(steps / 1000).toFixed(0)}k`}
              active={settings.goalSteps === steps}
              disabled={!connected}
              tone="emerald"
              onPress={() =>
                runSettingMutation(`Goal -> ${steps} steps`, () => manager.setWatchGoalSteps(steps))
              }
            />
          ))}
        </View>

        <View style={SHARED_LAYOUT_STYLES.divider} />
        <Text style={TYPOGRAPHY.overline}>Built-in Watch Face (#1..#6 · CMD 0x19)</Text>
        <View style={SHARED_LAYOUT_STYLES.chipWrap}>
          {WATCH_FACES.map((faceId) => (
            <ActionChip
              key={faceId}
              label={`Face #${faceId}`}
              active={settings.watchFaceId === faceId}
              disabled={!connected}
              tone="indigo"
              onPress={() =>
                runSettingMutation(`Watch Face #${faceId}`, () => manager.setWatchFace(faceId))
              }
            />
          ))}
        </View>

        <View style={SHARED_LAYOUT_STYLES.divider} />
        {watchToggles.map((t) => (
          <ToggleRow
            key={t.label}
            label={t.label}
            subtitle={t.subtitle}
            value={t.value}
            disabled={!connected}
            badge={t.badge}
            tone={t.tone}
            onValueChange={t.onChange}
          />
        ))}

        <View style={SHARED_LAYOUT_STYLES.divider} />
        <Text style={TYPOGRAPHY.overline}>24h Continuous Heart Rate Interval (CMD 0x16)</Text>
        <View style={SHARED_LAYOUT_STYLES.chipWrap}>
          {HR_INTERVAL_OPTIONS.map((mins) => (
            <ActionChip
              key={mins}
              label={mins === 0 ? 'Off' : `${mins} min`}
              active={settings.hrIntervalMinutes === mins}
              disabled={!connected}
              tone="rose"
              onPress={() =>
                runSettingMutation(
                  `HR Interval -> ${mins === 0 ? 'Off' : `${mins}m`}`,
                  () => manager.setWatchHrInterval(mins),
                )
              }
            />
          ))}
        </View>

        <View style={SHARED_LAYOUT_STYLES.divider} />
        <ToggleRow
          label="Drink Water Reminder Window"
          subtitle={`Active window ${pad2(drink.startHour)}:${pad2(drink.startMinute)} – ${pad2(drink.endHour)}:${pad2(drink.endMinute)}`}
          value={drink.enabled}
          disabled={!connected}
          tone="cyan"
          onValueChange={(next) =>
            runSettingMutation(`Drink Reminder ${next ? 'ON' : 'OFF'}`, () =>
              manager.setWatchDrinkReminder({ ...drink, enabled: next }),
            )
          }
        />
        <Stepper
          label="Drink Window Start Hour"
          value={drink.startHour}
          min={0}
          max={23}
          disabled={!connected}
          format={(v) => `${pad2(v)}:00`}
          onChange={(next) =>
            runSettingMutation(`Drink start ${pad2(next)}:00`, () =>
              manager.setWatchDrinkReminder({ ...drink, startHour: next }),
            )
          }
        />
        <Stepper
          label="Drink Window End Hour"
          value={drink.endHour}
          min={0}
          max={23}
          disabled={!connected}
          format={(v) => `${pad2(v)}:00`}
          onChange={(next) =>
            runSettingMutation(`Drink end ${pad2(next)}:00`, () =>
              manager.setWatchDrinkReminder({ ...drink, endHour: next }),
            )
          }
        />
      </Card>

      <SectionHeader
        style={SHARED_LAYOUT_STYLES.sectionGap}
        overline="CRREPA 0xB9 Alarm Protocol"
        title={`8-Slot Watch Alarm Manager (${watch.alarms.length}/${MAX_WATCH_ALARMS})`}
        subtitle="Select a slot (0..7), configure time & repeat bitmask, and write to watch"
      />
      <Card>
        <View style={SHARED_LAYOUT_STYLES.chipWrap}>
          {Array.from({ length: MAX_WATCH_ALARMS }, (_, slot) => {
            const existing = watch.alarms.find((a) => a.id === slot);
            return (
              <ActionChip
                key={slot}
                label={existing ? `#${slot} ${pad2(existing.hour)}:${pad2(existing.minute)}` : `Slot #${slot}`}
                compact
                active={selectedSlot === slot}
                tone={existing?.enabled ? 'emerald' : 'cyan'}
                onPress={() => setSelectedSlot(slot)}
              />
            );
          })}
        </View>
        <View style={SHARED_LAYOUT_STYLES.divider} />
        <ToggleRow
          label={`Alarm Slot #${selectedSlot} Enabled`}
          value={alarmEnabled}
          tone="emerald"
          onValueChange={setAlarmEnabled}
        />
        <Stepper label="Hour (0–23)" value={alarmHour} min={0} max={23} format={pad2} onChange={setAlarmHour} />
        <Stepper
          label="Minute (0–59)"
          value={alarmMinute}
          min={0}
          max={59}
          step={5}
          format={pad2}
          onChange={setAlarmMinute}
        />

        <Text style={[TYPOGRAPHY.overline, styles.topGap]}>
          Repeat Bitmask (0x{alarmRepeatMask.toString(16).toUpperCase().padStart(2, '0')})
        </Text>
        <View style={SHARED_LAYOUT_STYLES.chipWrap}>
          {WEEKDAY_BITS.map((d) => (
            <ActionChip
              key={d.label}
              label={d.label}
              compact
              active={(alarmRepeatMask & d.bit) !== 0}
              tone="cyan"
              onPress={() => setAlarmRepeatMask((prev) => prev ^ d.bit)}
            />
          ))}
          <ActionChip
            label="Everyday"
            compact
            active={alarmRepeatMask === CRP_ALARM_REPEAT.EVERYDAY}
            tone="emerald"
            onPress={() => setAlarmRepeatMask(CRP_ALARM_REPEAT.EVERYDAY)}
          />
          <ActionChip
            label="Once"
            compact
            active={alarmRepeatMask === CRP_ALARM_REPEAT.SINGLE}
            tone="neutral"
            onPress={() => setAlarmRepeatMask(CRP_ALARM_REPEAT.SINGLE)}
          />
        </View>

        <View style={[SHARED_LAYOUT_STYLES.inputRow, styles.topGap]}>
          <TextInput
            value={alarmLabel}
            onChangeText={setAlarmLabel}
            placeholder="Alarm label"
            placeholderTextColor={COLORS.textMuted}
            style={SHARED_LAYOUT_STYLES.textInput}
          />
          <PrimaryButton
            label={`Save Slot #${selectedSlot}`}
            tone="emerald"
            compact
            disabled={!connected}
            onPress={handleSaveAlarmSlot}
          />
        </View>

        {watch.alarms.length > 0 ? (
          <View style={styles.alarmList}>
            {watch.alarms.map((alarm) => (
              <View key={alarm.id} style={styles.alarmItem}>
                <View style={SHARED_LAYOUT_STYLES.flexOne}>
                  <Text style={TYPOGRAPHY.cardTitle}>
                    Slot #{alarm.id} · {pad2(alarm.hour)}:{pad2(alarm.minute)} · {alarm.label || 'Alarm'}
                  </Text>
                  <Text style={TYPOGRAPHY.caption}>
                    {alarm.enabled ? 'Enabled' : 'Disabled'} · Repeat mask {hex8(alarm.repeatMask)}
                  </Text>
                </View>
                <ActionChip
                  label="Delete"
                  compact
                  tone="rose"
                  disabled={!connected}
                  onPress={() =>
                    runSettingMutation(`Delete Alarm Slot #${alarm.id}`, () =>
                      manager.deleteWatchAlarm(alarm.id),
                    )
                  }
                />
              </View>
            ))}
          </View>
        ) : null}
      </Card>
    </>
  );
}

const styles = StyleSheet.create({
  topGap: { marginTop: SPACING.sm },
  alarmList: { gap: SPACING.sm, marginTop: SPACING.md },
  alarmItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.sm,
    padding: SPACING.sm,
    borderRadius: RADII.sm,
    backgroundColor: COLORS.surfaceWell,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
});
