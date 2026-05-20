import { useCallback, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  ZENMUX_CHAT_MODEL_GROUPS,
  zenmuxChatModelLabel,
  type ZenmuxChatModel,
} from '../lib/chatLlmModel';
import { colors, typography } from '../theme/colors';
import { zh } from '../locales/zh-CN';

type Props = {
  modelId: string;
  onSelect: (modelId: string) => void;
  compact?: boolean;
};

export function LlmModelPicker({ modelId, onSelect, compact }: Props) {
  const [open, setOpen] = useState(false);
  const label = zenmuxChatModelLabel(modelId);

  const pick = useCallback(
    (m: ZenmuxChatModel) => {
      onSelect(m.id);
      setOpen(false);
    },
    [onSelect],
  );

  return (
    <>
      <Pressable
        style={[styles.trigger, compact && styles.triggerCompact]}
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`${zh.chat.switchModel}：${label}`}
      >
        <Text style={[styles.triggerText, compact && styles.triggerTextCompact]} numberOfLines={1}>
          {label}
        </Text>
        <Text style={styles.chevron}>▾</Text>
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.sheetTitle}>{zh.chat.pickModel}</Text>
            <Text style={styles.sheetHint}>{zh.chat.pickModelHint}</Text>
            <ScrollView
              style={styles.list}
              contentContainerStyle={styles.listContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator
              bounces={false}
            >
              {ZENMUX_CHAT_MODEL_GROUPS.map((group) => (
                <View key={group.id} style={styles.group}>
                  <Text style={styles.groupTitle}>{group.title}</Text>
                  {group.models.map((m) => {
                    const active = m.id === modelId;
                    return (
                      <Pressable
                        key={m.id}
                        style={[styles.option, active && styles.optionActive]}
                        onPress={() => pick(m)}
                      >
                        <Text style={[styles.optionLabel, active && styles.optionLabelActive]}>
                          {m.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              ))}
            </ScrollView>
            <Pressable style={styles.closeBtn} onPress={() => setOpen(false)}>
              <Text style={styles.closeBtnText}>关闭</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    maxWidth: '100%',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: colors.background,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  triggerCompact: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  triggerText: {
    flexShrink: 1,
    fontSize: typography.title,
    fontWeight: '700',
    color: colors.text,
  },
  triggerTextCompact: {
    fontSize: typography.caption,
    fontWeight: '600',
  },
  chevron: {
    fontSize: 10,
    color: colors.textMuted,
  },
  backdrop: {
    flex: 1,
    backgroundColor: colors.backdrop,
    justifyContent: 'flex-end',
  },
  sheet: {
    maxHeight: '88%',
    backgroundColor: colors.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingTop: 16,
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  sheetTitle: {
    fontSize: typography.title,
    fontWeight: '700',
    color: colors.text,
  },
  sheetHint: {
    marginTop: 6,
    marginBottom: 12,
    fontSize: typography.caption,
    color: colors.textMuted,
    lineHeight: 18,
  },
  list: {
    flexGrow: 0,
    flexShrink: 1,
  },
  listContent: {
    paddingBottom: 4,
  },
  group: {
    marginBottom: 12,
  },
  groupTitle: {
    fontSize: typography.caption,
    fontWeight: '700',
    color: colors.textMuted,
    marginBottom: 6,
    marginLeft: 2,
  },
  option: {
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 10,
    marginBottom: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  optionActive: {
    backgroundColor: colors.insertBg,
    borderColor: colors.insertBorder,
  },
  optionLabel: {
    fontSize: typography.body,
    fontWeight: '600',
    color: colors.text,
  },
  optionLabelActive: {
    color: colors.insertText,
  },
  closeBtn: {
    marginTop: 8,
    alignItems: 'center',
    paddingVertical: 12,
  },
  closeBtnText: {
    fontSize: typography.body,
    color: colors.primary,
  },
});
