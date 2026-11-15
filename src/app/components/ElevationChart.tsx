import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';

import { M3 } from '../../domains/shared/theme/tokens.ts';

/** Bar-style elevation profile: x = distance, y = altitude. */
export function ElevationChart({ profile, height = 96 }: { profile: readonly [number, number][]; height?: number }): React.ReactElement | null {
  if (profile.length < 2) return null;
  const alts = profile.map((p) => p[1]);
  const min = Math.min(...alts);
  const max = Math.max(...alts);
  const span = Math.max(5, max - min);
  return (
    <View>
      <View style={[styles.chart, { height }]}>
        {profile.map(([, alt], i) => (
          <View key={i} style={[styles.bar, { height: 4 + ((alt - min) / span) * (height - 4) }]} />
        ))}
      </View>
      <View style={styles.axis}>
        <Text variant="labelSmall" style={styles.label}>{`${Math.round(min)} m`}</Text>
        <Text variant="labelSmall" style={styles.label}>{`${Math.round(max)} m`}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  chart: { flexDirection: 'row', alignItems: 'flex-end', gap: 1 },
  bar: { flex: 1, backgroundColor: M3.primary, opacity: 0.55, borderTopLeftRadius: 2, borderTopRightRadius: 2 },
  axis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  label: { color: M3.onSurfaceVariant },
});
