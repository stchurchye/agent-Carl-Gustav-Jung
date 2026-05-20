import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, typography } from '../theme/colors';
import { zh } from '../locales/zh-CN';

type Props = {
  visible: boolean;
  onClose: () => void;
  onChangeModel: () => void;
  onComposeContext: () => void;
  /** 群聊：跳转本话题记忆（流浪猫大脑） */
  onTopicMemory?: () => void;
};

export function AskAiHubSheet({
  visible,
  onClose,
  onChangeModel,
  onComposeContext,
  onTopicMemory,
}: Props) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.title}>{zh.chat.askAiHubTitle}</Text>
          <Text style={styles.hint}>{zh.chat.contextComposerHint}</Text>

          <Pressable
            style={styles.action}
            onPress={() => {
              onClose();
              onChangeModel();
            }}
          >
            <Text style={styles.actionTitle}>{zh.chat.changeLlmModel}</Text>
            <Text style={styles.actionHint}>{zh.chat.pickModel}</Text>
          </Pressable>

          <Pressable
            style={styles.action}
            onPress={() => {
              onClose();
              onComposeContext();
            }}
          >
            <Text style={styles.actionTitle}>{zh.chat.composeContext}</Text>
            <Text style={styles.actionHint}>{zh.chat.composeContextHint}</Text>
          </Pressable>

          {onTopicMemory ? (
            <Pressable
              style={styles.action}
              onPress={() => {
                onClose();
                onTopicMemory();
              }}
            >
              <Text style={styles.actionTitle}>{zh.me.topicMemoryTitle}</Text>
              <Text style={styles.actionHint}>{zh.chat.topicMemoryHint}</Text>
            </Pressable>
          ) : null}

          <Pressable style={styles.cancel} onPress={onClose}>
            <Text style={styles.cancelText}>{zh.writing.cancel}</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: colors.backdrop,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingTop: 20,
    paddingHorizontal: 16,
    paddingBottom: 28,
  },
  title: {
    fontSize: typography.title,
    fontWeight: '700',
    color: colors.text,
  },
  hint: {
    marginTop: 6,
    marginBottom: 16,
    fontSize: typography.caption,
    color: colors.textMuted,
    lineHeight: 18,
  },
  action: {
    paddingVertical: 16,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    marginBottom: 10,
    backgroundColor: colors.background,
  },
  actionTitle: {
    fontSize: typography.body,
    fontWeight: '700',
    color: colors.text,
  },
  actionHint: {
    marginTop: 4,
    fontSize: typography.caption,
    color: colors.textMuted,
    lineHeight: 18,
  },
  cancel: {
    marginTop: 8,
    alignItems: 'center',
    paddingVertical: 12,
  },
  cancelText: {
    fontSize: typography.body,
    color: colors.primary,
  },
});
