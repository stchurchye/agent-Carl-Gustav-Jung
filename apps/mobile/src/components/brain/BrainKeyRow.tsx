import { Pressable, StyleSheet, Text, View } from 'react-native';
import { evaBrain } from '../../theme/evaBrain';

type Props = {
  slotLabel: string;
  title: string;
  status: string;
  configured: boolean;
  onPress: () => void;
};

export function BrainKeyRow({ slotLabel, title, status, configured, onPress }: Props) {
  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      onPress={onPress}
      accessibilityRole="button"
    >
      <View style={styles.left}>
        <Text style={styles.slot}>{slotLabel}</Text>
        <Text style={styles.title}>{title}</Text>
        <View style={styles.statusRow}>
          <View style={[styles.dot, configured ? styles.dotOn : styles.dotOff]} />
          <Text style={[styles.status, configured && styles.statusOn]} numberOfLines={2}>
            {status}
          </Text>
        </View>
      </View>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 14,
    backgroundColor: evaBrain.bgCard,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: evaBrain.border,
    borderRadius: 4,
  },
  rowPressed: {
    backgroundColor: evaBrain.bgElevated,
    borderColor: evaBrain.accentBright,
  },
  left: { flex: 1, paddingRight: 8 },
  slot: {
    color: evaBrain.accentBright,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  title: {
    color: evaBrain.text,
    fontSize: 16,
    fontWeight: '600',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: 6,
    gap: 6,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    marginTop: 4,
  },
  dotOn: { backgroundColor: evaBrain.accent },
  dotOff: { backgroundColor: evaBrain.textDim },
  status: {
    flex: 1,
    color: evaBrain.textMuted,
    fontSize: 12,
    lineHeight: 17,
  },
  statusOn: {
    color: evaBrain.accent,
  },
  chevron: {
    color: evaBrain.textMuted,
    fontSize: 22,
    fontWeight: '300',
  },
});
