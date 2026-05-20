import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, typography } from '../theme/colors';

export type SegmentItem = { id: string; title: string };

type Props = {
  topics: SegmentItem[];
  activeId: string | null;
  onSelect: (topicId: string) => void;
  onAdd?: () => void;
  onLongPress?: (topicId: string) => void;
  addDisabled?: boolean;
  addingLabel?: string;
};

export function TopicSegmentBar({
  topics,
  activeId,
  onSelect,
  onAdd,
  onLongPress,
  addDisabled,
  addingLabel,
}: Props) {
  return (
    <View style={styles.wrap}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {topics.map((t) => {
          const active = t.id === activeId;
          return (
            <Pressable
              key={t.id}
              onPress={() => onSelect(t.id)}
              onLongPress={onLongPress ? () => onLongPress(t.id) : undefined}
              delayLongPress={520}
              style={[styles.chip, active && styles.chipActive]}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{t.title}</Text>
            </Pressable>
          );
        })}
        {onAdd ? (
          <Pressable
            onPress={onAdd}
            disabled={addDisabled}
            style={[styles.addChip, addDisabled && styles.addChipDisabled]}
          >
            <Text style={styles.addText}>{addingLabel ?? '+'}</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  row: { paddingHorizontal: 8, paddingVertical: 8, gap: 8, alignItems: 'center' },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  chipText: { fontSize: typography.caption, color: colors.textMuted },
  chipTextActive: { color: colors.text, fontWeight: '600' },
  addChip: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primarySoft,
  },
  addText: { fontSize: 18, color: colors.primary, fontWeight: '700' },
  addChipDisabled: { opacity: 0.5 },
});
