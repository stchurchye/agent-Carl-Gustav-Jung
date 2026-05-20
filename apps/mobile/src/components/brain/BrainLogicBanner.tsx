import { StyleSheet, Text, View } from 'react-native';
import type { BrainLogicHint } from '../../brain/logicHints';
import { zh } from '../../locales/zh-CN';
import { evaBrain } from '../../theme/evaBrain';

type Props = {
  hint: BrainLogicHint;
};

export function BrainLogicBanner({ hint }: Props) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>{zh.brain.logic.title}</Text>
      <Row label={zh.brain.logic.howRemember} value={hint.howRemember} />
      <Row label={zh.brain.logic.howUse} value={hint.howUse} />
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginHorizontal: 12,
    marginBottom: 12,
    padding: 12,
    borderLeftWidth: 3,
    borderLeftColor: evaBrain.accent,
    backgroundColor: evaBrain.bgCard,
    borderRadius: 4,
  },
  title: {
    color: evaBrain.accentBright,
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 10,
  },
  row: { marginBottom: 8 },
  label: {
    color: evaBrain.accent,
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 3,
  },
  value: {
    color: evaBrain.text,
    fontSize: 14,
    lineHeight: 21,
  },
});
