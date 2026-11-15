import React from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { CRP_MESSAGE_TYPE } from '../../../protocols/ultimaFitCrrepa.ts';
import {
  ActionChip,
  ActionStatusLine,
  Card,
  Notice,
  PrimaryButton,
  SectionHeader,
} from '../../shared/theme/primitives.tsx';
import {
  COLORS,
  SHARED_LAYOUT_STYLES,
  SPACING,
  TYPOGRAPHY,
  formatTimeAgo,
  hex8,
  useActionRunner,
} from '../../shared/theme/tokens.ts';
import type { ScreenProps } from '../../shared/theme/tokens.ts';
import { ActivitySleepVitalsSection } from './ActivitySleepVitalsSection.tsx';
import { AlarmsNotifySettingsSection } from './AlarmsNotifySettingsSection.tsx';
import { GpsWorkoutSection } from './GpsWorkoutSection.tsx';

const MESSAGE_TYPE_OPTIONS: readonly { label: string; code: number }[] = [
  { label: 'Phone Call (0x00)', code: CRP_MESSAGE_TYPE.CALL },
  { label: 'SMS (0x01)', code: CRP_MESSAGE_TYPE.SMS },
  { label: 'WhatsApp (0x04)', code: CRP_MESSAGE_TYPE.WHATSAPP },
  { label: 'Instagram (0x06)', code: CRP_MESSAGE_TYPE.INSTAGRAM },
  { label: 'Telegram (0x0E)', code: CRP_MESSAGE_TYPE.TELEGRAM },
  { label: 'Messenger (0x0C)', code: CRP_MESSAGE_TYPE.MESSENGER },
  { label: 'Gmail (0x11)', code: CRP_MESSAGE_TYPE.GMAIL },
  { label: 'Slack (0x34)', code: CRP_MESSAGE_TYPE.SLACK },
  { label: 'Discord (0x38)', code: CRP_MESSAGE_TYPE.DISCORD },
  { label: 'YouTube (0x21)', code: CRP_MESSAGE_TYPE.YOUTUBE },
  { label: 'Calendar (0x12)', code: CRP_MESSAGE_TYPE.CALENDAR_GOOGLE },
  { label: 'Other App (0x80)', code: CRP_MESSAGE_TYPE.OTHER },
];

/** ULTIMA Fit CRREPA 0xFEEA watch dashboard combining activity, vitals, settings, alarms, and GPS routes. */
export function HealthWatchScreen({
  snapshot,
  manager,
  store,
  storeState,
  onStoreChanged,
}: ScreenProps): React.ReactElement {
  const actions = useActionRunner();
  const { watch } = snapshot;
  const connected = watch.connected;
  const [notifType, setNotifType] = React.useState<number>(CRP_MESSAGE_TYPE.WHATSAPP);
  const [notifText, setNotifText] = React.useState<string>(
    'Ultima Open: 100% offline notification test',
  );

  return (
    <ScrollView
      style={SHARED_LAYOUT_STYLES.scroll}
      contentContainerStyle={SHARED_LAYOUT_STYLES.content}
      keyboardShouldPersistTaps="handled"
    >
      <SectionHeader
        overline="ULTIMA Fit Watch Studio (CRREPA 0xFEEA)"
        title={watch.name}
        subtitle={
          connected
            ? `FW ${watch.firmwareType ?? '—'} · Battery ${watch.batteryPercent}% · Synced ${
                watch.lastSyncedAt ? formatTimeAgo(watch.lastSyncedAt) : 'just now'
              }`
            : 'Connect your ULTIMA Fit watch in the Hub tab (or use Simulator) for live telemetry.'
        }
        right={
          <View style={styles.headerActions}>
            <PrimaryButton
              label="Sync All"
              tone="cyan"
              compact
              disabled={!connected}
              onPress={() =>
                actions.run('Sync All Watch Telemetry', async () => {
                  await manager.syncWatchAll();
                  onStoreChanged();
                })
              }
            />
            <PrimaryButton
              label="Find Watch"
              tone="amber"
              compact
              disabled={!connected}
              onPress={() => actions.run('Find Watch (0x61)', () => manager.findWatch())}
            />
          </View>
        }
      />

      <ActionStatusLine status={actions.status} />

      {!connected ? (
        <Notice
          tone="amber"
          text="Watch not connected. Connect in the Hub tab to trigger live CRREPA 0xFEEA measurements and settings sync."
        />
      ) : null}

      <ActivitySleepVitalsSection watch={watch} manager={manager} actions={actions} />
      <AlarmsNotifySettingsSection
        watch={watch}
        manager={manager}
        actions={actions}
        onStoreChanged={onStoreChanged}
      />

      <SectionHeader
        style={SHARED_LAYOUT_STYLES.sectionGap}
        overline="CRREPA CMD 0x41 Notification Relay"
        title="App Notification Push Tester"
        subtitle="Select a CRP_MESSAGE_TYPE byte and push a test alert directly to the watch"
      />
      <Card>
        <View style={SHARED_LAYOUT_STYLES.chipWrap}>
          {MESSAGE_TYPE_OPTIONS.map((opt) => (
            <ActionChip
              key={opt.label}
              label={opt.label}
              compact
              active={notifType === opt.code}
              tone="indigo"
              onPress={() => setNotifType(opt.code)}
            />
          ))}
        </View>
        <View style={[SHARED_LAYOUT_STYLES.inputRow, styles.topGap]}>
          <TextInput
            value={notifText}
            onChangeText={setNotifText}
            placeholder="Notification message payload"
            placeholderTextColor={COLORS.textMuted}
            style={SHARED_LAYOUT_STYLES.textInput}
          />
          <PrimaryButton
            label="Push (0x41)"
            tone="cyan"
            compact
            disabled={!connected || notifText.trim().length === 0}
            onPress={() =>
              actions.run(`Push Notification (${hex8(notifType)})`, () =>
                manager.pushWatchNotification(notifType, notifText.trim()),
              )
            }
          />
        </View>
        {watch.lastNotification ? (
          <Text style={TYPOGRAPHY.caption}>
            Last pushed: {hex8(watch.lastNotification.messageType)} &ldquo;
            {watch.lastNotification.text}&rdquo; ({formatTimeAgo(watch.lastNotification.sentAt)})
          </Text>
        ) : null}
      </Card>

      <GpsWorkoutSection
        watch={watch}
        manager={manager}
        store={store}
        storeState={storeState}
        actions={actions}
        onStoreChanged={onStoreChanged}
      />
    </ScrollView>
  );
}

export default HealthWatchScreen;

const styles = StyleSheet.create({
  headerActions: { flexDirection: 'row', gap: SPACING.xs },
  topGap: { marginTop: SPACING.sm },
});
