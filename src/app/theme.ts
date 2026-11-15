import { MD3DarkTheme, adaptNavigationTheme } from 'react-native-paper';
import type { MD3Theme } from 'react-native-paper';
import { DarkTheme as NavDarkTheme } from '@react-navigation/native';

import { M3 } from '../domains/shared/theme/tokens.ts';

/** Material 3 dark theme for Ultima Open (seed cyan). */
export const paperTheme: MD3Theme = {
  ...MD3DarkTheme,
  roundness: 4,
  colors: {
    ...MD3DarkTheme.colors,
    primary: M3.primary,
    onPrimary: M3.onPrimary,
    primaryContainer: M3.primaryContainer,
    onPrimaryContainer: M3.onPrimaryContainer,
    secondary: M3.secondary,
    onSecondary: M3.onSecondary,
    secondaryContainer: M3.secondaryContainer,
    onSecondaryContainer: M3.onSecondaryContainer,
    tertiary: M3.tertiary,
    onTertiary: M3.onTertiary,
    tertiaryContainer: M3.tertiaryContainer,
    onTertiaryContainer: M3.onTertiaryContainer,
    error: M3.error,
    onError: M3.onError,
    errorContainer: M3.errorContainer,
    onErrorContainer: M3.onErrorContainer,
    background: M3.background,
    onBackground: M3.onBackground,
    surface: M3.surface,
    onSurface: M3.onSurface,
    surfaceVariant: M3.surfaceVariant,
    onSurfaceVariant: M3.onSurfaceVariant,
    outline: M3.outline,
    outlineVariant: M3.outlineVariant,
    inverseSurface: M3.inverseSurface,
    inverseOnSurface: M3.inverseOnSurface,
    inversePrimary: M3.inversePrimary,
    elevation: {
      level0: 'transparent',
      level1: M3.surfaceContainerLow,
      level2: M3.surfaceContainer,
      level3: M3.surfaceContainerHigh,
      level4: '#2A3031',
      level5: M3.surfaceContainerHighest,
    },
    surfaceDisabled: 'rgba(222, 227, 229, 0.12)',
    onSurfaceDisabled: 'rgba(222, 227, 229, 0.38)',
    backdrop: 'rgba(41, 50, 52, 0.4)',
  },
};

const { DarkTheme: adaptedNav } = adaptNavigationTheme({ reactNavigationDark: NavDarkTheme, materialDark: paperTheme });

export const navigationTheme = {
  ...adaptedNav,
  colors: {
    ...adaptedNav.colors,
    background: M3.background,
    card: M3.surfaceContainer,
    border: M3.outlineVariant,
  },
  fonts: NavDarkTheme.fonts,
};
