import type { NavigatorScreenParams } from '@react-navigation/native';

export type TabParamList = {
  Home: undefined;
  Earbuds: undefined;
  Health: undefined;
  Settings: undefined;
};

export type VitalKind = 'hr' | 'spo2' | 'bp' | 'stress';

export type RootStackParamList = {
  Tabs: NavigatorScreenParams<TabParamList> | undefined;
  // Devices
  AddDevice: undefined;
  // Earbuds
  Equalizer: undefined;
  TouchControls: undefined;
  FindEarbuds: undefined;
  EarbudsAbout: undefined;
  // Health
  Measure: { kind: VitalKind };
  Sleep: undefined;
  Activity: undefined;
  Workouts: undefined;
  RecordWorkout: undefined;
  WorkoutDetail: { id: string };
  // Settings
  WatchSettings: undefined;
  Alarms: undefined;
  AlarmEdit: { id?: number };
  WatchNotifications: undefined;
  Calls: undefined;
  HealthApps: undefined;
  GoogleSheets: undefined;
  Devices: undefined;
  Backup: undefined;
  PacketLog: undefined;
  Database: undefined;
};

export type DetailRoute = Exclude<keyof RootStackParamList, 'Tabs'>;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace ReactNavigation {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface RootParamList extends RootStackParamList {}
  }
}
