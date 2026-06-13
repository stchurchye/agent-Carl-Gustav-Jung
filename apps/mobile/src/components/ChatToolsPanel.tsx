import { Platform, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme/colors';
import { useLayout } from '../theme/layout';
import { useTextStyles } from '../theme/useTextStyles';
import { formatSlashCommandsHint } from '@xzz/shared';
import { zh } from '../locales/zh-CN';

/** 问答页右侧浮层内的工具区 */
export function ChatToolsPanel() {
  const text = useTextStyles();
  const { captionFontSize, bodyLineHeight } = useLayout();

  return (
    <View style={styles.root}>
      <Text style={[styles.sectionTitle, text.caption]}>{zh.chat.toolsTipTitle}</Text>
      <Text style={[styles.tipText, { fontSize: captionFontSize, lineHeight: bodyLineHeight }]}>
        {zh.chat.toolsTipNewSession}
      </Text>
      <Text style={[styles.slashTitle, text.caption]}>{zh.chat.slashCommandsTitle}</Text>
      <Text style={[styles.tipText, { fontSize: captionFontSize, lineHeight: bodyLineHeight }]}>
        {zh.chat.slashCommandsHint}
      </Text>
      <Text style={[styles.slashList, { fontSize: captionFontSize, lineHeight: bodyLineHeight }]}>
        {formatSlashCommandsHint()}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0, gap: 8, paddingTop: 4 },
  sectionTitle: {
    color: colors.textMuted,
    fontWeight: '600',
    marginTop: 4,
    flexShrink: 0,
  },
  tipText: { color: colors.textMuted, flexShrink: 0 },
  slashTitle: {
    color: colors.textMuted,
    fontWeight: '600',
    flexShrink: 0,
  },
  slashList: {
    color: colors.textMuted,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    flexShrink: 0,
  },
});
