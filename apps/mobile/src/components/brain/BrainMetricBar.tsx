import { StyleSheet, Text, View } from 'react-native';
import { zh } from '../../locales/zh-CN';
import { evaBrain } from '../../theme/evaBrain';

type Props = {
  label: string;
  used: number;
  limit: number;
};

export function BrainMetricBar({ label, used, limit }: Props) {
  const ratio = limit > 0 ? Math.min(1, used / limit) : 0;
  const pct = Math.round(ratio * 100);

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.num}>
          {zh.brain.charsUsed(used, limit)} · {pct}%
          {zh.brain.metrics.percent}
        </Text>
      </View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${pct}%` }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginHorizontal: 12,
    marginBottom: 10,
  },
  head: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  label: {
    color: evaBrain.text,
    fontSize: 12,
    flex: 1,
  },
  num: {
    color: evaBrain.textMuted,
    fontSize: 11,
  },
  track: {
    height: 6,
    backgroundColor: evaBrain.bgElevated,
    borderRadius: 3,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    backgroundColor: evaBrain.accent,
    borderRadius: 3,
  },
});
