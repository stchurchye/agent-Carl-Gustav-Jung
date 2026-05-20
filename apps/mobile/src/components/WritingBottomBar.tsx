import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { ChatUiIcon } from './ChatUiIcon';
import { chatIcons } from '../assets/chatIcons';
import { writingIcons } from '../assets/writingIcons';
import { colors, typography } from '../theme/colors';
import { wechat } from '../theme/wechat';
import { zh } from '../locales/zh-CN';

type Props = {
  bottomInset: number;
  speaking: boolean;
  sharing: boolean;
  saving?: boolean;
  readHint?: string | null;
  assistantDisabled?: boolean;
  hasPendingSuggestion?: boolean;
  onCopy: () => void;
  onGenerateImage: () => void;
  onHistory: () => void;
  onReadAloud: () => void;
  onAssistant: () => void;
};

/** 写文章页底栏：工具图标 + 小助手（对齐群聊 toolRow + 请 AI） */
export function WritingBottomBar({
  bottomInset,
  speaking,
  sharing,
  saving,
  readHint,
  assistantDisabled,
  hasPendingSuggestion,
  onCopy,
  onGenerateImage,
  onHistory,
  onReadAloud,
  onAssistant,
}: Props) {
  return (
    <View style={[styles.wrap, { paddingBottom: Math.max(bottomInset, 6) }]}>
      {speaking && readHint ? (
        <Text style={styles.readHint} numberOfLines={1}>
          {readHint}
        </Text>
      ) : saving ? (
        <Text style={styles.readHint} numberOfLines={1}>
          {zh.writing.saving}
        </Text>
      ) : null}
      <View style={styles.row}>
        <View style={styles.icons}>
          <Pressable
            style={styles.iconBtn}
            onPress={onCopy}
            disabled={sharing}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={zh.writing.shareCopyText}
          >
            <ChatUiIcon source={writingIcons.copy} size={22} />
          </Pressable>
          <Pressable
            style={styles.iconBtn}
            onPress={onGenerateImage}
            disabled={sharing}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={zh.writing.shareGenerateImage}
          >
            {sharing ? (
              <ActivityIndicator color={colors.primary} size="small" />
            ) : (
              <ChatUiIcon source={writingIcons.generateImage} size={22} />
            )}
          </Pressable>
          <Pressable
            style={styles.iconBtn}
            onPress={onHistory}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={zh.writing.history}
          >
            <ChatUiIcon source={writingIcons.history} size={22} />
          </Pressable>
          <Pressable
            style={styles.iconBtn}
            onPress={onReadAloud}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={speaking ? zh.writing.stopReading : zh.writing.readMode}
          >
            <ChatUiIcon source={chatIcons.readAloud} size={22} active={speaking} />
          </Pressable>
        </View>
        <Pressable
          style={[
            styles.assistantBtn,
            assistantDisabled && styles.assistantBtnDisabled,
            hasPendingSuggestion && styles.assistantBtnPending,
          ]}
          onPress={onAssistant}
          disabled={assistantDisabled}
          accessibilityRole="button"
          accessibilityLabel={zh.writing.openAssistant}
        >
          <Text style={styles.assistantBtnText}>{zh.writing.assistantTitle}</Text>
          {hasPendingSuggestion ? <View style={styles.assistantBadge} /> : null}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: wechat.navBg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: wechat.navBorder,
    paddingTop: 4,
  },
  readHint: {
    fontSize: typography.small,
    color: colors.primary,
    paddingHorizontal: 12,
    paddingBottom: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingBottom: 2,
    gap: 8,
  },
  icons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flex: 1,
  },
  iconBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  assistantBtn: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: '#4caf50',
    position: 'relative',
  },
  assistantBtnDisabled: { opacity: 0.45 },
  assistantBtnPending: {
    borderWidth: 2,
    borderColor: colors.insertBorder,
  },
  assistantBtnText: {
    color: '#000000',
    fontWeight: '700',
    fontSize: typography.caption,
  },
  assistantBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.insertBorder,
  },
});
