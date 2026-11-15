import React from 'react';
import { CommonActions } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import type { BottomTabHeaderProps } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { NativeStackHeaderProps } from '@react-navigation/native-stack';
import { Appbar, BottomNavigation, Icon } from 'react-native-paper';

import { M3 } from '../domains/shared/theme/tokens.ts';
import type { RootStackParamList, TabParamList, VitalKind } from './routes.ts';
import { HomeScreen } from './screens/HomeScreen.tsx';
import { AddDeviceScreen } from './screens/AddDeviceScreen.tsx';
import { EarbudsScreen } from './screens/earbuds/EarbudsScreen.tsx';
import { EqualizerScreen } from './screens/earbuds/EqualizerScreen.tsx';
import { TouchControlsScreen } from './screens/earbuds/TouchControlsScreen.tsx';
import { FindEarbudsScreen } from './screens/earbuds/FindEarbudsScreen.tsx';
import { EarbudsAboutScreen } from './screens/earbuds/EarbudsAboutScreen.tsx';
import { HealthScreen } from './screens/health/HealthScreen.tsx';
import { MeasureScreen } from './screens/health/MeasureScreen.tsx';
import { SleepScreen } from './screens/health/SleepScreen.tsx';
import { ActivityScreen } from './screens/health/ActivityScreen.tsx';
import { WorkoutsScreen } from './screens/health/WorkoutsScreen.tsx';
import { SettingsScreen } from './screens/settings/SettingsScreen.tsx';
import { WatchSettingsScreen } from './screens/settings/WatchSettingsScreen.tsx';
import { AlarmsScreen } from './screens/settings/AlarmsScreen.tsx';
import { AlarmEditScreen } from './screens/settings/AlarmEditScreen.tsx';
import { CallsScreen } from './screens/settings/CallsScreen.tsx';
import { HealthAppsScreen } from './screens/settings/HealthAppsScreen.tsx';
import { GoogleSheetsScreen } from './screens/settings/GoogleSheetsScreen.tsx';
import { RecordWorkoutScreen } from './screens/health/RecordWorkoutScreen.tsx';
import { WorkoutDetailScreen } from './screens/health/WorkoutDetailScreen.tsx';
import { WatchNotificationsScreen } from './screens/settings/WatchNotificationsScreen.tsx';
import { DevicesScreen } from './screens/settings/DevicesScreen.tsx';
import { BackupScreen } from './screens/settings/BackupScreen.tsx';
import { PacketLogScreen } from './screens/settings/PacketLogScreen.tsx';
import { DatabaseScreen } from './screens/settings/DatabaseScreen.tsx';

const Tab = createBottomTabNavigator<TabParamList>();
const Stack = createNativeStackNavigator<RootStackParamList>();

const TAB_META: Record<keyof TabParamList, { title: string; icon: string; iconFocused: string }> = {
  Home: { title: 'Home', icon: 'home-outline', iconFocused: 'home' },
  Earbuds: { title: 'Earbuds', icon: 'earbuds-outline', iconFocused: 'earbuds' },
  Health: { title: 'Health', icon: 'heart-outline', iconFocused: 'heart' },
  Settings: { title: 'Settings', icon: 'cog-outline', iconFocused: 'cog' },
};

const VITAL_TITLES: Record<VitalKind, string> = {
  hr: 'Heart rate',
  spo2: 'Blood oxygen',
  bp: 'Blood pressure',
  stress: 'Stress',
};

const TITLES: Record<Exclude<keyof RootStackParamList, 'Tabs' | 'Measure' | 'AlarmEdit'>, string> = {
  AddDevice: 'Add a device',
  Equalizer: 'Equalizer',
  TouchControls: 'Touch controls',
  FindEarbuds: 'Find my earbuds',
  EarbudsAbout: 'About earbuds',
  Sleep: 'Sleep',
  Activity: 'Activity',
  Workouts: 'Workouts',
  RecordWorkout: 'Record workout',
  WorkoutDetail: 'Workout',
  WatchSettings: 'Watch settings',
  Alarms: 'Alarms',
  WatchNotifications: 'Notifications',
  Calls: 'Calls',
  HealthApps: 'Health apps',
  GoogleSheets: 'Google Sheets',
  Devices: 'My devices',
  Backup: 'Backup & data',
  PacketLog: 'Packet log',
  Database: 'Database',
};

function TabHeader({ route }: BottomTabHeaderProps): React.ReactElement {
  const meta = TAB_META[route.name as keyof TabParamList];
  return (
    <Appbar.Header mode="medium" elevated={false} style={{ backgroundColor: M3.background }}>
      <Appbar.Content title={meta.title} />
    </Appbar.Header>
  );
}

function StackHeader({ navigation, options, back }: NativeStackHeaderProps): React.ReactElement {
  return (
    <Appbar.Header elevated={false} style={{ backgroundColor: M3.background }}>
      {back ? <Appbar.BackAction onPress={navigation.goBack} /> : null}
      <Appbar.Content title={typeof options.title === 'string' ? options.title : ''} />
    </Appbar.Header>
  );
}

function Tabs(): React.ReactElement {
  return (
    <Tab.Navigator
      backBehavior="firstRoute"
      screenOptions={({ route }) => ({
        header: (props) => <TabHeader {...props} />,
        tabBarIcon: ({ focused, color }) => {
          const meta = TAB_META[route.name];
          return <Icon source={focused ? meta.iconFocused : meta.icon} size={24} color={color} />;
        },
      })}
      tabBar={({ navigation, state, descriptors, insets }) => (
        <BottomNavigation.Bar
          navigationState={state}
          safeAreaInsets={insets}
          style={{ backgroundColor: M3.surfaceContainer }}
          activeIndicatorStyle={{ backgroundColor: M3.secondaryContainer }}
          activeColor={M3.onSecondaryContainer}
          inactiveColor={M3.onSurfaceVariant}
          onTabPress={({ route, preventDefault }) => {
            const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
            if (event.defaultPrevented) preventDefault();
            else navigation.dispatch({ ...CommonActions.navigate(route.name, route.params), target: state.key });
          }}
          renderIcon={({ route, focused, color }) =>
            descriptors[route.key]?.options.tabBarIcon?.({ focused, color, size: 24 }) ?? null
          }
          getLabelText={({ route }) => TAB_META[route.name as keyof TabParamList].title}
        />
      )}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Earbuds" component={EarbudsScreen} />
      <Tab.Screen name="Health" component={HealthScreen} />
      <Tab.Screen name="Settings" component={SettingsScreen} />
    </Tab.Navigator>
  );
}

export function AppNavigator(): React.ReactElement {
  return (
    <Stack.Navigator
      screenOptions={({ route }) => ({
        header: (props) => <StackHeader {...props} />,
        title:
          route.name === 'Tabs'
            ? ''
            : route.name === 'Measure'
              ? VITAL_TITLES[(route.params as { kind: VitalKind } | undefined)?.kind ?? 'hr']
              : route.name === 'AlarmEdit'
                ? (route.params as { id?: number } | undefined)?.id === undefined
                  ? 'New alarm'
                  : 'Edit alarm'
                : TITLES[route.name],
        animation: 'slide_from_right',
        contentStyle: { backgroundColor: M3.background },
      })}
    >
      <Stack.Screen name="Tabs" component={Tabs} options={{ headerShown: false }} />
      <Stack.Screen name="AddDevice" component={AddDeviceScreen} />
      <Stack.Screen name="Equalizer" component={EqualizerScreen} />
      <Stack.Screen name="TouchControls" component={TouchControlsScreen} />
      <Stack.Screen name="FindEarbuds" component={FindEarbudsScreen} />
      <Stack.Screen name="EarbudsAbout" component={EarbudsAboutScreen} />
      <Stack.Screen name="Measure" component={MeasureScreen} />
      <Stack.Screen name="Sleep" component={SleepScreen} />
      <Stack.Screen name="Activity" component={ActivityScreen} />
      <Stack.Screen name="Workouts" component={WorkoutsScreen} />
      <Stack.Screen name="WatchSettings" component={WatchSettingsScreen} />
      <Stack.Screen name="Alarms" component={AlarmsScreen} />
      <Stack.Screen name="AlarmEdit" component={AlarmEditScreen} />
      <Stack.Screen name="WatchNotifications" component={WatchNotificationsScreen} />
      <Stack.Screen name="Calls" component={CallsScreen} />
      <Stack.Screen name="HealthApps" component={HealthAppsScreen} />
      <Stack.Screen name="GoogleSheets" component={GoogleSheetsScreen} />
      <Stack.Screen name="RecordWorkout" component={RecordWorkoutScreen} />
      <Stack.Screen name="WorkoutDetail" component={WorkoutDetailScreen} />
      <Stack.Screen name="Devices" component={DevicesScreen} />
      <Stack.Screen name="Backup" component={BackupScreen} />
      <Stack.Screen name="PacketLog" component={PacketLogScreen} />
      <Stack.Screen name="Database" component={DatabaseScreen} />
    </Stack.Navigator>
  );
}
