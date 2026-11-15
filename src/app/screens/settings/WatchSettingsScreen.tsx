import React from 'react';

import { useApp } from '../../AppContext.tsx';
import { Banner, Card, ChoiceTiles, Gap, RowGroup, Screen, SectionLabel, SwitchRow, useTask } from '../../ui.tsx';
import type { Choice } from '../../ui.tsx';

const GOALS: readonly Choice<number>[] = [6000, 8000, 10000, 12000, 15000].map((v) => ({
  value: v,
  label: `${(v / 1000).toFixed(0)},000`,
}));

const FACES: readonly Choice<number>[] = [1, 2, 3, 4, 5, 6].map((v) => ({ value: v, label: `Face ${v}`, icon: 'watch-variant' }));

const HR_INTERVALS: readonly Choice<number>[] = [0, 5, 10, 20, 30].map((v) => ({
  value: v,
  label: v === 0 ? 'Off' : `${v} min`,
}));

interface DrinkWindow {
  startHour: number;
  endHour: number;
}

const DRINK_WINDOWS: readonly DrinkWindow[] = [
  { startHour: 8, endHour: 20 },
  { startHour: 9, endHour: 18 },
  { startHour: 7, endHour: 22 },
];

function hourLabel(h: number): string {
  const suffix = h < 12 ? 'am' : 'pm';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12} ${suffix}`;
}

function windowKey(w: DrinkWindow): string {
  return `${w.startHour}-${w.endHour}`;
}

/** Goal, watch face, display and reminder settings for the watch. */
export function WatchSettingsScreen(): React.ReactElement {
  const { snapshot, manager, onStoreChanged } = useApp();
  const { busy, run } = useTask();
  const watch = snapshot.watch;
  const connected = watch.connected;
  const s = watch.settings;
  const drink = s.drinkReminderPeriod;

  const apply = (key: string, fn: () => Promise<void>): void => {
    void run(
      key,
      async () => {
        await fn();
        onStoreChanged();
      },
      { failure: 'Couldn’t update your watch' },
    );
  };

  const currentWindow: DrinkWindow = { startHour: drink.startHour, endHour: drink.endHour };
  const windows = DRINK_WINDOWS.some((w) => windowKey(w) === windowKey(currentWindow))
    ? DRINK_WINDOWS
    : [...DRINK_WINDOWS, currentWindow];
  const windowChoices: Choice<string>[] = windows.map((w) => ({
    value: windowKey(w),
    label: `${hourLabel(w.startHour)} – ${hourLabel(w.endHour)}`,
  }));

  const disabled = !connected;

  return (
    <Screen>
      {!connected ? (
        <Banner icon="watch-variant" text="Connect your watch to change these settings. You’re seeing the last saved values." />
      ) : null}

      <SectionLabel>Daily step goal</SectionLabel>
      <Card>
        <ChoiceTiles
          options={GOALS}
          value={s.goalSteps}
          columns={3}
          disabled={disabled || busy('goal')}
          onChange={(v) => apply('goal', () => manager.setWatchGoalSteps(v))}
        />
      </Card>

      <SectionLabel>Watch face</SectionLabel>
      <Card>
        <ChoiceTiles
          options={FACES}
          value={s.watchFaceId}
          columns={3}
          disabled={disabled || busy('face')}
          onChange={(v) => apply('face', () => manager.setWatchFace(v))}
        />
      </Card>

      <SectionLabel>Display</SectionLabel>
      <RowGroup>
        <SwitchRow
          icon="clock-outline"
          title="24-hour time"
          subtitle={s.is24Hour ? 'Shows 14:30' : 'Shows 2:30 PM'}
          value={s.is24Hour}
          disabled={disabled || busy('time')}
          onValueChange={(v) => apply('time', () => manager.setWatchTimeFormat(v))}
        />
        <SwitchRow
          icon="gesture-swipe-up"
          tone="emerald"
          title="Raise to wake"
          subtitle="Turn the screen on when you lift your wrist"
          value={s.quickView}
          disabled={disabled || busy('quick')}
          onValueChange={(v) => apply('quick', () => manager.setWatchQuickView(v))}
        />
        <SwitchRow
          icon="map-marker-distance"
          tone="amber"
          title="Use miles"
          subtitle={s.imperialUnits ? 'Distances in miles' : 'Distances in kilometres'}
          value={s.imperialUnits}
          disabled={disabled || busy('units')}
          onValueChange={(v) => apply('units', () => manager.setWatchUnits(v))}
        />
      </RowGroup>

      <SectionLabel>Reminders</SectionLabel>
      <RowGroup>
        <SwitchRow
          icon="walk"
          tone="indigo"
          title="Move reminder"
          subtitle="Vibrate after an hour without moving"
          value={s.sedentaryReminder}
          disabled={disabled || busy('sedentary')}
          onValueChange={(v) => apply('sedentary', () => manager.setWatchSedentaryReminder(v))}
        />
        <SwitchRow
          icon="cup-water"
          title="Drink water reminder"
          subtitle={`Between ${hourLabel(drink.startHour)} and ${hourLabel(drink.endHour)}`}
          value={drink.enabled}
          disabled={disabled || busy('drink')}
          onValueChange={(v) => apply('drink', () => manager.setWatchDrinkReminder({ ...drink, enabled: v }))}
        />
      </RowGroup>
      {drink.enabled ? (
        <>
          <Gap size={4} />
          <Card>
            <ChoiceTiles
              options={windowChoices}
              value={windowKey(currentWindow)}
              columns={2}
              disabled={disabled || busy('drink')}
              onChange={(key) => {
                const [start, end] = key.split('-').map(Number);
                apply('drink', () =>
                  manager.setWatchDrinkReminder({ ...drink, startHour: start ?? 8, startMinute: 0, endHour: end ?? 20, endMinute: 0 }),
                );
              }}
            />
          </Card>
        </>
      ) : null}

      <SectionLabel>All-day heart rate</SectionLabel>
      <Card>
        <ChoiceTiles
          options={HR_INTERVALS}
          value={s.hrIntervalMinutes}
          columns={3}
          disabled={disabled || busy('hr')}
          onChange={(v) => apply('hr', () => manager.setWatchHrInterval(v))}
        />
      </Card>
    </Screen>
  );
}
