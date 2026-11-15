/**
 * Ultima Open UI kit — the only building blocks screens should use.
 *
 * Principles:
 *  - One title per screen (the app bar). Sections get a small label, never an overline + title + subtitle stack.
 *  - Plain language. No protocol names, opcodes, storage engines, or "offline vector" marketing.
 *  - Primary colour is reserved for the selected state and the main action on a screen.
 *  - Touch targets ≥ 48dp. Selected state = filled container + check, never just a thin outline.
 */
import React from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { ActivityIndicator, Button, Divider, Icon, IconButton, Snackbar, Switch, Text, TouchableRipple } from 'react-native-paper';

import { M3, getTonePalette } from '../domains/shared/theme/tokens.ts';
import type { AccentTone } from '../domains/shared/theme/tokens.ts';

export type Tone = AccentTone;

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export function Screen({
  children,
  refreshing,
  onRefresh,
}: {
  children: React.ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
}): React.ReactElement {
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.screenContent}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        onRefresh ? (
          <RefreshControl
            refreshing={Boolean(refreshing)}
            onRefresh={onRefresh}
            tintColor={M3.primary}
            colors={[M3.primary]}
            progressBackgroundColor={M3.surfaceContainerHigh}
          />
        ) : undefined
      }
    >
      {children}
    </ScrollView>
  );
}

/** Small label above a group of content. Optional trailing text action. */
export function SectionLabel({
  children,
  action,
}: {
  children: string;
  action?: { label: string; onPress: () => void };
}): React.ReactElement {
  return (
    <View style={styles.sectionLabelRow}>
      <Text variant="titleSmall" style={styles.sectionLabel}>
        {children}
      </Text>
      {action ? (
        <Button compact mode="text" onPress={action.onPress} labelStyle={styles.sectionAction}>
          {action.label}
        </Button>
      ) : null}
    </View>
  );
}

export function Card({
  children,
  onPress,
  style,
  padded = true,
  tone,
  accessibilityLabel,
}: {
  children: React.ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
  /** Tinted container (e.g. selected / highlighted card). */
  tone?: Tone;
  accessibilityLabel?: string;
}): React.ReactElement {
  const bg = tone ? getTonePalette(tone).bg : M3.surfaceContainer;
  const inner = <View style={padded ? styles.cardPad : null}>{children}</View>;
  if (!onPress) return <View style={[styles.card, { backgroundColor: bg }, style]}>{inner}</View>;
  return (
    <View style={[styles.card, { backgroundColor: bg }, style]}>
      <TouchableRipple onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel} borderless>
        {inner}
      </TouchableRipple>
    </View>
  );
}

export function Gap({ size = 12 }: { size?: number }): React.ReactElement {
  return <View style={{ height: size }} />;
}

export function HStack({
  children,
  gap = 12,
  style,
  align = 'center',
}: {
  children: React.ReactNode;
  gap?: number;
  style?: StyleProp<ViewStyle>;
  align?: 'center' | 'flex-start' | 'flex-end' | 'stretch';
}): React.ReactElement {
  return <View style={[{ flexDirection: 'row', alignItems: align, gap }, style]}>{children}</View>;
}

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

export function IconBadge({ icon, tone = 'cyan', size = 40 }: { icon: string; tone?: Tone; size?: number }): React.ReactElement {
  const p = getTonePalette(tone);
  return (
    <View style={[styles.iconBadge, { width: size, height: size, borderRadius: size / 2, backgroundColor: p.bg }]}>
      <Icon source={icon} size={Math.round(size * 0.55)} color={p.fg} />
    </View>
  );
}

export interface RowProps {
  icon?: string;
  tone?: Tone;
  title: string;
  subtitle?: string | null;
  /** 'chevron' for navigation, or any node (value text, switch…). */
  right?: 'chevron' | React.ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  danger?: boolean;
}

export function Row({ icon, tone = 'cyan', title, subtitle, right, onPress, disabled, danger }: RowProps): React.ReactElement {
  const content = (
    <View style={[styles.row, disabled ? styles.disabled : null]}>
      {icon ? <IconBadge icon={icon} tone={danger ? 'rose' : tone} /> : null}
      <View style={styles.rowText}>
        <Text variant="bodyLarge" style={[styles.rowTitle, danger ? { color: M3.error } : null]} numberOfLines={2}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="bodyMedium" style={styles.muted} numberOfLines={3}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right === 'chevron' ? (
        <Icon source="chevron-right" size={24} color={M3.onSurfaceVariant} />
      ) : typeof right === 'string' ? (
        <Text variant="bodyMedium" style={styles.muted}>
          {right}
        </Text>
      ) : (
        right ?? null
      )}
    </View>
  );
  if (!onPress) return content;
  return (
    <TouchableRipple onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={title}>
      {content}
    </TouchableRipple>
  );
}

/** Rounded card holding rows separated by inset dividers. */
export function RowGroup({ children }: { children: React.ReactNode }): React.ReactElement {
  const items = React.Children.toArray(children).filter(Boolean);
  return (
    <View style={styles.group}>
      {items.map((child, i) => (
        <React.Fragment key={i}>
          {i > 0 ? <Divider style={styles.groupDivider} /> : null}
          {child}
        </React.Fragment>
      ))}
    </View>
  );
}

export function SwitchRow({
  icon,
  tone,
  title,
  subtitle,
  value,
  onValueChange,
  disabled,
}: {
  icon?: string;
  tone?: Tone;
  title: string;
  subtitle?: string;
  value: boolean;
  onValueChange: (next: boolean) => void;
  disabled?: boolean;
}): React.ReactElement {
  return (
    <Row
      icon={icon}
      tone={tone}
      title={title}
      subtitle={subtitle}
      disabled={disabled}
      onPress={disabled ? undefined : () => onValueChange(!value)}
      right={<Switch value={value} onValueChange={onValueChange} disabled={disabled} color={M3.primary} />}
    />
  );
}

// ---------------------------------------------------------------------------
// Status & data display
// ---------------------------------------------------------------------------

export function Pill({ label, tone = 'neutral', icon }: { label: string; tone?: Tone; icon?: string }): React.ReactElement {
  const p = getTonePalette(tone);
  return (
    <View style={[styles.pill, { backgroundColor: p.bg }]}>
      {icon ? <Icon source={icon} size={14} color={p.fg} /> : <View style={[styles.pillDot, { backgroundColor: p.fg }]} />}
      <Text variant="labelMedium" style={{ color: p.fg }}>
        {label}
      </Text>
    </View>
  );
}

/** Horizontal progress bar (0..1). */
export function Meter({ value, tone = 'cyan', height = 8 }: { value: number; tone?: Tone; height?: number }): React.ReactElement {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  return (
    <View style={[styles.meterTrack, { height, borderRadius: height / 2 }]}>
      <View style={{ width: `${clamped * 100}%`, height, borderRadius: height / 2, backgroundColor: getTonePalette(tone).fg }} />
    </View>
  );
}

export function batteryTone(percent: number | null | undefined): Tone {
  if (percent == null || percent < 0) return 'neutral';
  if (percent <= 15) return 'rose';
  if (percent <= 30) return 'amber';
  return 'emerald';
}

export function batteryIcon(percent: number | null | undefined, charging?: boolean): string {
  if (percent == null || percent < 0) return 'battery-unknown';
  if (charging) return 'battery-charging';
  const step = Math.max(10, Math.min(100, Math.round(percent / 10) * 10));
  return step === 100 ? 'battery' : `battery-${step}`;
}

/** Compact battery readout: icon + percent + label. */
export function Battery({
  label,
  percent,
  charging,
}: {
  label?: string;
  percent: number | null | undefined;
  charging?: boolean;
}): React.ReactElement {
  const known = percent != null && percent >= 0;
  const tone = batteryTone(known ? percent : null);
  return (
    <View style={styles.battery}>
      <HStack gap={4}>
        <Icon source={batteryIcon(known ? percent : null, charging)} size={20} color={known ? getTonePalette(tone).fg : M3.onSurfaceVariant} />
        <Text variant="titleMedium" style={styles.onSurface}>
          {known ? `${Math.round(percent)}%` : '—'}
        </Text>
      </HStack>
      {label ? (
        <Text variant="labelMedium" style={styles.muted}>
          {label}
        </Text>
      ) : null}
    </View>
  );
}

/** Large number with unit and caption, e.g. "6,240 steps". */
export function BigStat({
  value,
  unit,
  caption,
  tone,
}: {
  value: string;
  unit?: string;
  caption?: string;
  tone?: Tone;
}): React.ReactElement {
  return (
    <View>
      <HStack gap={6} align="flex-end">
        <Text variant="displaySmall" style={[styles.bigValue, tone ? { color: getTonePalette(tone).fg } : null]}>
          {value}
        </Text>
        {unit ? (
          <Text variant="titleMedium" style={[styles.muted, styles.bigUnit]}>
            {unit}
          </Text>
        ) : null}
      </HStack>
      {caption ? (
        <Text variant="bodyMedium" style={styles.muted}>
          {caption}
        </Text>
      ) : null}
    </View>
  );
}

/** Square-ish tile showing one metric; tappable. */
export function StatTile({
  icon,
  tone = 'cyan',
  value,
  unit,
  label,
  onPress,
}: {
  icon: string;
  tone?: Tone;
  value: string;
  unit?: string;
  label: string;
  onPress?: () => void;
}): React.ReactElement {
  return (
    <Card onPress={onPress} style={styles.flex1} accessibilityLabel={`${label} ${value}${unit ? ` ${unit}` : ''}`}>
      <Icon source={icon} size={22} color={getTonePalette(tone).fg} />
      <HStack gap={4} align="flex-end" style={styles.tileValueRow}>
        <Text variant="headlineSmall" style={styles.onSurface} numberOfLines={1}>
          {value}
        </Text>
        {unit ? (
          <Text variant="labelLarge" style={[styles.muted, styles.tileUnit]}>
            {unit}
          </Text>
        ) : null}
      </HStack>
      <Text variant="labelLarge" style={styles.muted} numberOfLines={1}>
        {label}
      </Text>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface Choice<T extends string | number> {
  value: T;
  label: string;
  icon?: string;
  description?: string;
}

/**
 * Large selectable tiles. Selected = filled primary container + check.
 * Use instead of rows of small outlined chips.
 */
export function ChoiceTiles<T extends string | number>({
  options,
  value,
  onChange,
  columns = 2,
  disabled,
}: {
  options: readonly Choice<T>[];
  value: T | null;
  onChange: (next: T) => void;
  columns?: 2 | 3 | 4;
  disabled?: boolean;
}): React.ReactElement {
  const basis = `${100 / columns - 2}%` as const;
  return (
    <View style={[styles.tiles, disabled ? styles.disabled : null]}>
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={String(o.value)}
            onPress={() => onChange(o.value)}
            disabled={disabled}
            accessibilityRole="radio"
            accessibilityState={{ selected, disabled }}
            accessibilityLabel={o.label}
            style={({ pressed }) => [
              styles.tile,
              { flexBasis: basis },
              selected ? styles.tileSelected : null,
              pressed ? styles.pressed : null,
            ]}
          >
            <HStack gap={8}>
              {o.icon ? <Icon source={o.icon} size={20} color={selected ? M3.onPrimaryContainer : M3.onSurfaceVariant} /> : null}
              <Text
                variant="labelLarge"
                numberOfLines={1}
                style={[styles.flex1, { color: selected ? M3.onPrimaryContainer : M3.onSurface }]}
              >
                {o.label}
              </Text>
              {selected && columns <= 2 ? <Icon source="check-circle" size={18} color={M3.onPrimaryContainer} /> : null}
            </HStack>
            {o.description ? (
              <Text variant="bodySmall" numberOfLines={2} style={{ color: selected ? M3.onPrimaryContainer : M3.onSurfaceVariant, marginTop: 4 }}>
                {o.description}
              </Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

/** Tap-to-set level, 0..max, shown as segments with − / + buttons. */
export function LevelPicker({
  value,
  max,
  onChange,
  disabled,
  label,
}: {
  value: number;
  max: number;
  onChange: (next: number) => void;
  disabled?: boolean;
  label: string;
}): React.ReactElement {
  const segments = Math.max(1, Math.min(max, 12));
  const step = max / segments;
  const filled = Math.round(value / step);
  return (
    <View style={disabled ? styles.disabled : null} accessibilityLabel={`${label} ${value} of ${max}`}>
      <HStack style={styles.levelHeader}>
        <Text variant="bodyLarge" style={[styles.onSurface, styles.flex1]}>
          {label}
        </Text>
        <Text variant="labelLarge" style={styles.muted}>
          {value} / {max}
        </Text>
      </HStack>
      <HStack gap={4}>
        <IconButton icon="minus" mode="contained-tonal" size={20} disabled={disabled || value <= 0} onPress={() => onChange(Math.max(0, value - 1))} accessibilityLabel={`Decrease ${label}`} />
        <View style={styles.levelTrack}>
          {Array.from({ length: segments }, (_, i) => (
            <Pressable
              key={i}
              disabled={disabled}
              onPress={() => onChange(Math.round((i + 1) * step))}
              style={[styles.levelSeg, { backgroundColor: i < filled ? M3.primary : M3.surfaceContainerHighest }]}
              accessibilityLabel={`Set ${label} to ${Math.round((i + 1) * step)}`}
            />
          ))}
        </View>
        <IconButton icon="plus" mode="contained-tonal" size={20} disabled={disabled || value >= max} onPress={() => onChange(Math.min(max, value + 1))} accessibilityLabel={`Increase ${label}`} />
      </HStack>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export function EmptyState({
  icon,
  title,
  body,
  action,
  secondary,
}: {
  icon: string;
  title: string;
  body?: string;
  action?: { label: string; onPress: () => void; icon?: string; loading?: boolean };
  secondary?: { label: string; onPress: () => void };
}): React.ReactElement {
  return (
    <View style={styles.empty}>
      <IconBadge icon={icon} tone="cyan" size={72} />
      <Text variant="titleLarge" style={[styles.onSurface, styles.centerText]}>
        {title}
      </Text>
      {body ? (
        <Text variant="bodyMedium" style={[styles.muted, styles.centerText]}>
          {body}
        </Text>
      ) : null}
      {action ? (
        <Button mode="contained" icon={action.icon} onPress={action.onPress} loading={action.loading} style={styles.emptyButton} contentStyle={styles.buttonContent}>
          {action.label}
        </Button>
      ) : null}
      {secondary ? (
        <Button mode="text" onPress={secondary.onPress}>
          {secondary.label}
        </Button>
      ) : null}
    </View>
  );
}

export function Banner({
  tone = 'amber',
  icon = 'information-outline',
  text,
  action,
}: {
  tone?: Tone;
  icon?: string;
  text: string;
  action?: { label: string; onPress: () => void };
}): React.ReactElement {
  const p = getTonePalette(tone);
  return (
    <View style={[styles.banner, { backgroundColor: p.bg }]}>
      <Icon source={icon} size={20} color={p.fg} />
      <Text variant="bodyMedium" style={[styles.flex1, { color: M3.onSurface }]}>
        {text}
      </Text>
      {action ? (
        <Button compact mode="text" textColor={p.fg} onPress={action.onPress}>
          {action.label}
        </Button>
      ) : null}
    </View>
  );
}

export function Muted({ children, center }: { children: React.ReactNode; center?: boolean }): React.ReactElement {
  return (
    <Text variant="bodyMedium" style={[styles.muted, center ? styles.centerText : null]}>
      {children}
    </Text>
  );
}

export function Spinner(): React.ReactElement {
  return <ActivityIndicator color={M3.primary} />;
}

// ---------------------------------------------------------------------------
// Feedback (snackbar) + async task runner
// ---------------------------------------------------------------------------

interface FeedbackValue {
  show: (message: string) => void;
}

const FeedbackContext = React.createContext<FeedbackValue>({ show: () => undefined });

export function FeedbackProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [message, setMessage] = React.useState<string | null>(null);
  const value = React.useMemo<FeedbackValue>(() => ({ show: (m) => setMessage(m) }), []);
  return (
    <FeedbackContext.Provider value={value}>
      {children}
      <Snackbar visible={message !== null} onDismiss={() => setMessage(null)} duration={3500} action={{ label: 'OK', onPress: () => setMessage(null) }}>
        {message ?? ''}
      </Snackbar>
    </FeedbackContext.Provider>
  );
}

export function useFeedback(): FeedbackValue {
  return React.useContext(FeedbackContext);
}

/** Strips internal prefixes from manager errors so users see a readable reason. */
export function friendlyError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (/not connected/i.test(raw)) return 'The device isn’t connected.';
  if (/permission/i.test(raw)) return 'Bluetooth permission is needed. Allow it in system settings.';
  if (/powered ?off|bluetooth.*off|PoweredOff/i.test(raw)) return 'Bluetooth is off. Turn it on and try again.';
  if (/timed? ?out|timeout/i.test(raw)) return 'The device didn’t respond. Make sure it’s nearby and try again.';
  return raw.replace(/\s*\(0x[0-9a-f]+\)/gi, '').replace(/^Error:\s*/, '');
}

/**
 * Runs async device actions with a busy flag and snackbar feedback.
 * `run(key, fn, { success })` — errors always surface; success message optional.
 */
export function useTask(): {
  busy: (key: string) => boolean;
  run: (key: string, fn: () => Promise<unknown> | unknown, opts?: { success?: string; failure?: string }) => Promise<boolean>;
} {
  const { show } = useFeedback();
  const [busyKeys, setBusyKeys] = React.useState<ReadonlySet<string>>(new Set());
  const mounted = React.useRef(true);
  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const run = React.useCallback(
    async (key: string, fn: () => Promise<unknown> | unknown, opts?: { success?: string; failure?: string }): Promise<boolean> => {
      if (mounted.current) setBusyKeys((s) => new Set(s).add(key));
      try {
        await fn();
        if (opts?.success) show(opts.success);
        return true;
      } catch (err) {
        show(`${opts?.failure ?? 'Something went wrong'}. ${friendlyError(err)}`);
        return false;
      } finally {
        if (mounted.current) {
          setBusyKeys((s) => {
            const n = new Set(s);
            n.delete(key);
            return n;
          });
        }
      }
    },
    [show],
  );
  const busy = React.useCallback((key: string) => busyKeys.has(key), [busyKeys]);
  return { busy, run };
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

export function formatNumber(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

export function formatMinutes(total: number): string {
  const m = Math.max(0, Math.round(total));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${r}m`;
  return r === 0 ? `${h}h` : `${h}h ${r}m`;
}

export function timeAgo(epochMs: number | null | undefined, now = Date.now()): string | null {
  if (!epochMs) return null;
  const s = Math.max(0, Math.round((now - epochMs) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: M3.background },
  screenContent: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 48, gap: 12 },
  sectionLabelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 16, marginHorizontal: 4, minHeight: 32 },
  sectionLabel: { color: M3.onSurfaceVariant },
  sectionAction: { marginVertical: 4 },
  card: { borderRadius: 24, overflow: 'hidden' },
  cardPad: { padding: 20, gap: 4 },
  iconBadge: { alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 16, paddingVertical: 14, minHeight: 64 },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { color: M3.onSurface },
  group: { backgroundColor: M3.surfaceContainer, borderRadius: 24, overflow: 'hidden' },
  groupDivider: { marginLeft: 72, backgroundColor: M3.outlineVariant },
  disabled: { opacity: 0.4 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  pillDot: { width: 6, height: 6, borderRadius: 3 },
  meterTrack: { backgroundColor: M3.surfaceContainerHighest, overflow: 'hidden', width: '100%' },
  battery: { gap: 2 },
  bigValue: { color: M3.onSurface, fontWeight: '600' },
  bigUnit: { marginBottom: 6 },
  tileValueRow: { marginTop: 12 },
  tileUnit: { marginBottom: 3 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between' },
  tile: {
    flexGrow: 1,
    minHeight: 52,
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 16,
    backgroundColor: M3.surfaceContainerHigh,
  },
  tileSelected: { backgroundColor: M3.primaryContainer },
  pressed: { opacity: 0.8 },
  levelHeader: { marginBottom: 4 },
  levelTrack: { flex: 1, flexDirection: 'row', gap: 4, height: 28, alignItems: 'center' },
  levelSeg: { flex: 1, height: 20, borderRadius: 6 },
  empty: { alignItems: 'center', gap: 12, paddingVertical: 40, paddingHorizontal: 24 },
  emptyButton: { marginTop: 8, alignSelf: 'stretch' },
  buttonContent: { height: 48 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingLeft: 16, paddingRight: 8, paddingVertical: 10, borderRadius: 16, minHeight: 48 },
  muted: { color: M3.onSurfaceVariant },
  onSurface: { color: M3.onSurface },
  centerText: { textAlign: 'center' },
  flex1: { flex: 1 },
});
