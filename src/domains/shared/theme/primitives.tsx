import React from 'react';
import { Pressable, Switch, Text, View } from 'react-native';
import type { StyleProp, TextStyle, ViewStyle } from 'react-native';

import {
  COLORS,
  PRIMITIVE_STYLES,
  TYPOGRAPHY,
  getTonePalette,
} from './tokens.ts';
import type { AccentTone, ActionStatus } from './tokens.ts';

export interface CardProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  tone?: AccentTone;
  padded?: boolean;
}

export function Card({
  children,
  style,
  tone,
  padded = true,
}: CardProps): React.ReactElement {
  const borderColor = tone ? getTonePalette(tone).border : COLORS.border;
  return (
    <View style={[PRIMITIVE_STYLES.card, { borderColor }, padded ? PRIMITIVE_STYLES.cardPadded : null, style]}>
      {children}
    </View>
  );
}

export interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  overline?: string;
  style?: StyleProp<ViewStyle>;
}

export function SectionHeader({
  title,
  subtitle,
  right,
  overline,
  style,
}: SectionHeaderProps): React.ReactElement {
  return (
    <View style={[PRIMITIVE_STYLES.sectionHeader, style]}>
      <View style={PRIMITIVE_STYLES.sectionHeaderLeft}>
        {overline ? <Text style={TYPOGRAPHY.overline}>{overline}</Text> : null}
        <Text style={TYPOGRAPHY.sectionTitle}>{title}</Text>
        {subtitle ? <Text style={TYPOGRAPHY.sectionSubtitle}>{subtitle}</Text> : null}
      </View>
      {right ? <View style={PRIMITIVE_STYLES.sectionHeaderRight}>{right}</View> : null}
    </View>
  );
}

export interface ActionChipProps {
  label: string;
  onPress: () => void;
  active?: boolean;
  tone?: AccentTone;
  disabled?: boolean;
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}

export function ActionChip({
  label,
  onPress,
  active = false,
  tone = 'cyan',
  disabled = false,
  compact = false,
  style,
  textStyle,
}: ActionChipProps): React.ReactElement {
  const palette = getTonePalette(tone);
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }: { pressed: boolean }) => [
        PRIMITIVE_STYLES.chip,
        compact ? PRIMITIVE_STYLES.chipCompact : null,
        {
          backgroundColor: active ? palette.bg : COLORS.surfaceWell,
          borderColor: active ? palette.border : COLORS.border,
          opacity: disabled ? 0.45 : pressed ? 0.78 : 1,
        },
        style,
      ]}
    >
      <Text
        numberOfLines={1}
        style={[
          PRIMITIVE_STYLES.chipText,
          compact ? PRIMITIVE_STYLES.chipTextCompact : null,
          { color: active ? palette.fg : COLORS.textSecondary },
          textStyle,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export interface ToggleRowProps {
  label: string;
  subtitle?: string;
  value: boolean;
  onValueChange: (next: boolean) => void;
  disabled?: boolean;
  tone?: AccentTone;
  badge?: string;
}

export function ToggleRow({
  label,
  subtitle,
  value,
  onValueChange,
  disabled = false,
  tone = 'cyan',
  badge,
}: ToggleRowProps): React.ReactElement {
  const palette = getTonePalette(tone);
  return (
    <View style={[PRIMITIVE_STYLES.toggleRow, disabled ? PRIMITIVE_STYLES.disabledRow : null]}>
      <View style={PRIMITIVE_STYLES.toggleRowText}>
        <View style={PRIMITIVE_STYLES.toggleTitleLine}>
          <Text style={TYPOGRAPHY.cardTitle}>{label}</Text>
          {badge ? (
            <View
              style={[
                PRIMITIVE_STYLES.inlineBadge,
                { backgroundColor: palette.bg, borderColor: palette.border },
              ]}
            >
              <Text style={[PRIMITIVE_STYLES.inlineBadgeText, { color: palette.fg }]}>
                {badge}
              </Text>
            </View>
          ) : null}
        </View>
        {subtitle ? <Text style={TYPOGRAPHY.sectionSubtitle}>{subtitle}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        trackColor={{ false: COLORS.borderStrong, true: palette.border }}
        thumbColor={value ? palette.fg : COLORS.textSecondary}
        ios_backgroundColor={COLORS.borderStrong}
      />
    </View>
  );
}

export interface OfflineBadgeProps {
  label?: string;
  tone?: AccentTone;
  compact?: boolean;
}

export function OfflineBadge({
  label = 'Offline Verified ✓',
  tone = 'emerald',
  compact = false,
}: OfflineBadgeProps): React.ReactElement {
  const palette = getTonePalette(tone);
  return (
    <View
      style={[
        PRIMITIVE_STYLES.offlineBadge,
        compact ? PRIMITIVE_STYLES.offlineBadgeCompact : null,
        { backgroundColor: palette.bg, borderColor: palette.border },
      ]}
    >
      <View style={[PRIMITIVE_STYLES.statusDot, { backgroundColor: palette.fg }]} />
      <Text
        style={[
          PRIMITIVE_STYLES.offlineBadgeText,
          compact ? PRIMITIVE_STYLES.offlineBadgeTextCompact : null,
          { color: palette.fg },
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

export interface ProgressBarProps {
  progress: number;
  tone?: AccentTone;
  height?: number;
  style?: StyleProp<ViewStyle>;
}

export function ProgressBar({
  progress,
  tone = 'emerald',
  height = 8,
  style,
}: ProgressBarProps): React.ReactElement {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
  const palette = getTonePalette(tone);
  const widthPct = `${Math.round(clamped * 100)}%` as `${number}%`;
  return (
    <View style={[PRIMITIVE_STYLES.progressTrack, { height }, style]}>
      <View
        style={[
          PRIMITIVE_STYLES.progressFill,
          { width: widthPct, backgroundColor: palette.fg },
        ]}
      />
    </View>
  );
}

export interface PrimaryButtonProps {
  label: string;
  onPress: () => void;
  tone?: AccentTone;
  disabled?: boolean;
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function PrimaryButton({
  label,
  onPress,
  tone = 'cyan',
  disabled = false,
  compact = false,
  style,
}: PrimaryButtonProps): React.ReactElement {
  const palette = getTonePalette(tone);
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }: { pressed: boolean }) => [
        PRIMITIVE_STYLES.primaryBtn,
        compact ? PRIMITIVE_STYLES.primaryBtnCompact : null,
        {
          backgroundColor: palette.bg,
          borderColor: palette.border,
          opacity: disabled ? 0.45 : pressed ? 0.78 : 1,
        },
        style,
      ]}
    >
      <Text
        style={[
          PRIMITIVE_STYLES.primaryBtnText,
          compact ? PRIMITIVE_STYLES.primaryBtnTextCompact : null,
          { color: palette.fg },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export interface ActionStatusLineProps {
  status: ActionStatus;
}

export function ActionStatusLine({
  status,
}: ActionStatusLineProps): React.ReactElement | null {
  if (status.kind === 'idle') return null;
  const tone: AccentTone =
    status.kind === 'error' ? 'rose' : status.kind === 'ok' ? 'emerald' : 'cyan';
  return <Notice text={status.text} tone={tone} />;
}

export interface NoticeProps {
  text: string;
  tone?: AccentTone;
}

export function Notice({ text, tone = 'amber' }: NoticeProps): React.ReactElement {
  const palette = getTonePalette(tone);
  return (
    <View
      style={[
        PRIMITIVE_STYLES.statusLine,
        { backgroundColor: palette.bg, borderColor: palette.border },
      ]}
    >
      <Text style={[PRIMITIVE_STYLES.statusLineText, { color: palette.fg }]}>{text}</Text>
    </View>
  );
}

export interface StatPillProps {
  label: string;
  value: string;
  tone?: AccentTone;
}

export function StatPill({
  label,
  value,
  tone = 'neutral',
}: StatPillProps): React.ReactElement {
  const palette = getTonePalette(tone);
  return (
    <View
      style={[
        PRIMITIVE_STYLES.statPill,
        { backgroundColor: palette.bg, borderColor: palette.border },
      ]}
    >
      <Text style={TYPOGRAPHY.overline}>{label}</Text>
      <Text style={[PRIMITIVE_STYLES.statPillValue, { color: palette.fg }]}>{value}</Text>
    </View>
  );
}

export interface StepperProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (next: number) => void;
  disabled?: boolean;
  tone?: AccentTone;
  format?: (value: number) => string;
}

export function Stepper({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  disabled = false,
  tone = 'cyan',
  format,
}: StepperProps): React.ReactElement {
  const palette = getTonePalette(tone);
  const display = format ? format(value) : String(value);
  return (
    <View style={[PRIMITIVE_STYLES.stepperRow, disabled ? PRIMITIVE_STYLES.disabledRow : null]}>
      <Text style={[TYPOGRAPHY.cardTitle, PRIMITIVE_STYLES.stepperLabel]}>{label}</Text>
      <View style={PRIMITIVE_STYLES.stepperControls}>
        <ActionChip
          label="−"
          compact
          disabled={disabled || value <= min}
          onPress={() => onChange(Math.max(min, value - step))}
          tone={tone}
        />
        <Text style={[PRIMITIVE_STYLES.stepperValue, { color: palette.fg }]}>{display}</Text>
        <ActionChip
          label="+"
          compact
          disabled={disabled || value >= max}
          onPress={() => onChange(Math.min(max, value + step))}
          tone={tone}
        />
      </View>
    </View>
  );
}
