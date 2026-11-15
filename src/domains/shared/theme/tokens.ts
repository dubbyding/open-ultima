import React from 'react';
import { Platform, StyleSheet } from 'react-native';
import type {
  BleManagerSnapshot,
  UltimaBleManager,
} from '../../../services/bleManager.ts';
import type { OfflineAppState, OfflineStore } from '../../../storage/offlineStore.ts';

/**
 * Material 3 dark scheme (seed: cyan #00BCD4). Semantic accent tones use the
 * dark-theme "80" tonal values so they sit on M3 surfaces with AA contrast.
 */
export const M3 = {
  primary: '#4FD8EB',
  onPrimary: '#00363D',
  primaryContainer: '#004F58',
  onPrimaryContainer: '#97F0FF',
  secondary: '#B1CBD0',
  onSecondary: '#1C3438',
  secondaryContainer: '#334B4F',
  onSecondaryContainer: '#CDE7EC',
  tertiary: '#BAC6EA',
  onTertiary: '#24304D',
  tertiaryContainer: '#3B4664',
  onTertiaryContainer: '#DAE2FF',
  error: '#FFB4AB',
  onError: '#690005',
  errorContainer: '#93000A',
  onErrorContainer: '#FFDAD6',
  background: '#0E1415',
  onBackground: '#DEE3E5',
  surface: '#0E1415',
  onSurface: '#DEE3E5',
  surfaceVariant: '#3F484A',
  onSurfaceVariant: '#BFC8CA',
  surfaceContainerLowest: '#090F10',
  surfaceContainerLow: '#171D1E',
  surfaceContainer: '#1B2122',
  surfaceContainerHigh: '#252B2C',
  surfaceContainerHighest: '#303637',
  outline: '#899294',
  outlineVariant: '#3F484A',
  inverseSurface: '#DEE3E5',
  inverseOnSurface: '#2B3133',
  inversePrimary: '#006874',
} as const;

export const COLORS = {
  bg: M3.background,
  surface: M3.surfaceContainer,
  surfaceElevated: M3.surfaceContainerHigh,
  surfaceWell: M3.surfaceContainerLow,
  border: M3.outlineVariant,
  borderStrong: M3.outline,

  cyan: M3.primary,
  cyanDim: 'rgba(79, 216, 235, 0.14)',
  cyanBorder: 'rgba(79, 216, 235, 0.38)',

  emerald: '#7FDBA0',
  emeraldDim: 'rgba(127, 219, 160, 0.14)',
  emeraldBorder: 'rgba(127, 219, 160, 0.38)',

  amber: '#F3C25A',
  amberDim: 'rgba(243, 194, 90, 0.14)',
  amberBorder: 'rgba(243, 194, 90, 0.38)',

  rose: M3.error,
  roseDim: 'rgba(255, 180, 171, 0.14)',
  roseBorder: 'rgba(255, 180, 171, 0.38)',

  indigo: '#B9C3FF',
  indigoDim: 'rgba(185, 195, 255, 0.14)',
  indigoBorder: 'rgba(185, 195, 255, 0.38)',

  /** Text/icon color on top of a solid accent fill. */
  onAccent: '#0B1A1D',
  overlay: 'rgba(14, 20, 21, 0.88)',

  textPrimary: M3.onSurface,
  textSecondary: M3.onSurfaceVariant,
  textMuted: '#8A9496',
  white: '#FFFFFF',
  black: '#000000',
} as const;

export const SPACING = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

/** M3 shape scale: extra-small 4, small 8, medium 12, large 16, extra-large 28. */
export const RADII = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 28,
  pill: 999,
} as const;

export const MONO_FONT = Platform.select({
  ios: 'Menlo',
  android: 'monospace',
  default: 'monospace',
});

export type AccentTone = 'cyan' | 'emerald' | 'amber' | 'rose' | 'indigo' | 'neutral';

/** Returns foreground, background, and border colors for a UI accent tone. */
export function getTonePalette(tone: AccentTone): {
  fg: string;
  bg: string;
  border: string;
} {
  switch (tone) {
    case 'cyan':
      return { fg: COLORS.cyan, bg: COLORS.cyanDim, border: COLORS.cyanBorder };
    case 'emerald':
      return { fg: COLORS.emerald, bg: COLORS.emeraldDim, border: COLORS.emeraldBorder };
    case 'amber':
      return { fg: COLORS.amber, bg: COLORS.amberDim, border: COLORS.amberBorder };
    case 'rose':
      return { fg: COLORS.rose, bg: COLORS.roseDim, border: COLORS.roseBorder };
    case 'indigo':
      return { fg: COLORS.indigo, bg: COLORS.indigoDim, border: COLORS.indigoBorder };
    case 'neutral':
    default:
      return {
        fg: COLORS.textSecondary,
        bg: COLORS.surfaceElevated,
        border: COLORS.borderStrong,
      };
  }
}

/** Material 3 type scale mapped onto the legacy style names used by sections. */
export const TYPOGRAPHY = StyleSheet.create({
  /** headlineSmall */
  screenTitle: { fontSize: 24, lineHeight: 32, fontWeight: '400', color: COLORS.textPrimary },
  /** titleLarge */
  sectionTitle: { fontSize: 22, lineHeight: 28, fontWeight: '400', color: COLORS.textPrimary },
  /** bodyMedium */
  sectionSubtitle: { fontSize: 14, lineHeight: 20, letterSpacing: 0.25, color: COLORS.textSecondary, marginTop: 2 },
  /** titleMedium */
  cardTitle: { fontSize: 16, lineHeight: 24, fontWeight: '500', letterSpacing: 0.15, color: COLORS.textPrimary },
  /** bodyMedium */
  body: { fontSize: 14, lineHeight: 20, letterSpacing: 0.25, color: COLORS.textPrimary },
  /** bodySmall */
  caption: { fontSize: 12, lineHeight: 16, letterSpacing: 0.4, color: COLORS.textSecondary },
  /** labelMedium */
  overline: { fontSize: 12, lineHeight: 16, fontWeight: '500', letterSpacing: 0.5, color: COLORS.textSecondary },
  mono: { fontFamily: MONO_FONT, fontSize: 11, color: COLORS.textPrimary, fontVariant: ['tabular-nums'] },
  /** headlineMedium */
  metricValue: { fontSize: 28, lineHeight: 36, fontWeight: '400', color: COLORS.textPrimary, fontVariant: ['tabular-nums'] },
});

/** Shared layout styles reused across domain tab screens. */
export const SHARED_LAYOUT_STYLES = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  content: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.xxl * 2,
  },
  sectionGap: {
    marginTop: SPACING.xl,
  },
  cardGap: {
    marginTop: SPACING.md,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: COLORS.border,
    marginVertical: SPACING.md,
  },
  flexOne: {
    flex: 1,
  },
  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
  },
  chipRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
    marginTop: SPACING.xs,
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
    marginTop: SPACING.xs,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    marginTop: SPACING.xs,
  },
  textInput: {
    flex: 1,
    backgroundColor: COLORS.surfaceElevated,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADII.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: 11,
    color: COLORS.textPrimary,
    fontSize: 14,
  },
  rowButtons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
    marginTop: SPACING.sm,
  },
});

export function batteryColor(level: number): string {
  if (level <= 20) return COLORS.amber;
  return COLORS.emerald;
}

export function formatTimeAgo(epochMs: number): string {
  if (!Number.isFinite(epochMs) || epochMs <= 0) return 'Never';
  const diffSec = Math.max(0, Math.floor((Date.now() - epochMs) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
}

export function hex16(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '—';
  }
  return `0x${(value & 0xffff).toString(16).toUpperCase().padStart(4, '0')}`;
}

export function hex8(value: number): string {
  return `0x${(value & 0xff).toString(16).toUpperCase().padStart(2, '0')}`;
}

export function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

export function parseIntOr(text: string, fallback: number): number {
  const parsed = Number.parseInt(text.trim(), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export interface ScreenProps {
  snapshot: BleManagerSnapshot;
  manager: UltimaBleManager;
  store: OfflineStore;
  storeState: OfflineAppState;
  /** Call after mutating the OfflineStore directly so the UI re-reads it. */
  onStoreChanged: () => void;
}

export type ActionStatusKind = 'idle' | 'busy' | 'ok' | 'error';

export interface ActionStatus {
  kind: ActionStatusKind;
  text: string;
}

export interface ActionRunner {
  status: ActionStatus;
  busy: boolean;
  run: (label: string, action: () => Promise<unknown> | unknown) => void;
  clear: () => void;
}

/**
 * Runs a (possibly async) manager action, capturing thrown errors (e.g. "not
 * connected") into a visible status line instead of an unhandled rejection.
 */
export function useActionRunner(): ActionRunner {
  const [status, setStatus] = React.useState<ActionStatus>({
    kind: 'idle',
    text: '',
  });
  const mountedRef = React.useRef(true);
  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const run = React.useCallback(
    (label: string, action: () => Promise<unknown> | unknown): void => {
      const execute = async (): Promise<void> => {
        if (mountedRef.current) setStatus({ kind: 'busy', text: `${label}…` });
        try {
          await action();
          if (mountedRef.current) setStatus({ kind: 'ok', text: `${label} ✓` });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (mountedRef.current) {
            setStatus({ kind: 'error', text: `${label} failed: ${message}` });
          }
        }
      };
      void execute();
    },
    [],
  );

  const clear = React.useCallback((): void => {
    setStatus({ kind: 'idle', text: '' });
  }, []);

  return { status, busy: status.kind === 'busy', run, clear };
}
