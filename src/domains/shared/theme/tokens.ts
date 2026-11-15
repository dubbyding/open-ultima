import React from 'react';
import { Platform, StyleSheet } from 'react-native';
import type {
  BleManagerSnapshot,
  UltimaBleManager,
} from '../../../services/bleManager.ts';
import type { OfflineAppState, OfflineStore } from '../../../storage/offlineStore.ts';

export const COLORS = {
  bg: '#0A0D14',
  surface: '#121826',
  surfaceElevated: '#172033',
  surfaceWell: '#0D121C',
  border: '#1E293B',
  borderStrong: '#334155',

  cyan: '#22D3EE',
  cyanDim: 'rgba(34, 211, 238, 0.14)',
  cyanBorder: 'rgba(34, 211, 238, 0.35)',

  emerald: '#34D399',
  emeraldDim: 'rgba(52, 211, 153, 0.14)',
  emeraldBorder: 'rgba(52, 211, 153, 0.35)',

  amber: '#F59E0B',
  amberDim: 'rgba(245, 158, 11, 0.14)',
  amberBorder: 'rgba(245, 158, 11, 0.35)',

  rose: '#FB7185',
  roseDim: 'rgba(251, 113, 133, 0.14)',
  roseBorder: 'rgba(251, 113, 133, 0.35)',

  indigo: '#818CF8',
  indigoDim: 'rgba(129, 140, 248, 0.14)',
  indigoBorder: 'rgba(129, 140, 248, 0.35)',

  textPrimary: '#F8FAFC',
  textSecondary: '#94A3B8',
  textMuted: '#64748B',
  white: '#FFFFFF',
  black: '#000000',
} as const;

export const SPACING = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
} as const;

export const RADII = {
  sm: 8,
  md: 12,
  lg: 16,
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

export const TYPOGRAPHY = StyleSheet.create({
  screenTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: COLORS.textPrimary,
    letterSpacing: -0.3,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.textPrimary,
    letterSpacing: 0.1,
  },
  sectionSubtitle: {
    fontSize: 12,
    fontWeight: '400',
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textPrimary,
  },
  body: {
    fontSize: 13,
    fontWeight: '400',
    color: COLORS.textPrimary,
    lineHeight: 18,
  },
  caption: {
    fontSize: 11,
    fontWeight: '500',
    color: COLORS.textSecondary,
  },
  overline: {
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.textMuted,
    letterSpacing: 0.9,
    textTransform: 'uppercase',
  },
  mono: {
    fontFamily: MONO_FONT,
    fontSize: 11,
    color: COLORS.textPrimary,
    fontVariant: ['tabular-nums'],
  },
  metricValue: {
    fontSize: 22,
    fontWeight: '700',
    color: COLORS.textPrimary,
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.4,
  },
});

/** Shared layout styles reused across domain tab screens. */
export const SHARED_LAYOUT_STYLES = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  content: {
    padding: SPACING.lg,
    paddingBottom: SPACING.xxl * 2,
  },
  sectionGap: {
    marginTop: SPACING.xl,
  },
  cardGap: {
    marginTop: SPACING.md,
  },
  divider: {
    height: 1,
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
    backgroundColor: COLORS.surfaceWell,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADII.sm,
    paddingHorizontal: SPACING.md,
    paddingVertical: 8,
    color: COLORS.textPrimary,
    fontSize: 13,
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

export const PRIMITIVE_STYLES = StyleSheet.create({
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: RADII.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  cardPadded: { padding: SPACING.lg },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.md,
    marginBottom: SPACING.md,
  },
  sectionHeaderLeft: { flex: 1 },
  sectionHeaderRight: { flexShrink: 0 },
  chip: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: RADII.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipCompact: { paddingHorizontal: 10, paddingVertical: 5 },
  chipText: { fontSize: 12, fontWeight: '600' },
  chipTextCompact: { fontSize: 11 },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: SPACING.sm,
    gap: SPACING.md,
  },
  disabledRow: { opacity: 0.45 },
  toggleRowText: { flex: 1 },
  toggleTitleLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    flexWrap: 'wrap',
  },
  inlineBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: RADII.sm,
    borderWidth: 1,
  },
  inlineBadgeText: { fontSize: 10, fontWeight: '700', fontFamily: MONO_FONT },
  offlineBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: RADII.pill,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  offlineBadgeCompact: { paddingHorizontal: 8, paddingVertical: 3 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  offlineBadgeText: { fontSize: 11, fontWeight: '700' },
  offlineBadgeTextCompact: { fontSize: 10 },
  progressTrack: {
    width: '100%',
    backgroundColor: COLORS.surfaceWell,
    borderRadius: RADII.pill,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
  },
  progressFill: { height: '100%', borderRadius: RADII.pill },
  primaryBtn: {
    paddingHorizontal: SPACING.lg,
    paddingVertical: 11,
    borderRadius: RADII.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnCompact: { paddingHorizontal: SPACING.md, paddingVertical: 7, borderRadius: RADII.sm },
  primaryBtnText: { fontSize: 13, fontWeight: '700' },
  primaryBtnTextCompact: { fontSize: 12 },
  statusLine: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: RADII.sm,
    borderWidth: 1,
    marginTop: SPACING.sm,
  },
  statusLineText: { fontSize: 12, fontWeight: '600' },
  statPill: {
    flexGrow: 1,
    flexBasis: 80,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: RADII.md,
    borderWidth: 1,
    gap: 2,
  },
  statPillValue: { fontSize: 16, fontWeight: '700', fontVariant: ['tabular-nums'] },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: SPACING.xs,
    gap: SPACING.md,
  },
  stepperLabel: { flex: 1 },
  stepperControls: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  stepperValue: {
    minWidth: 52,
    textAlign: 'center',
    fontSize: 15,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
});
