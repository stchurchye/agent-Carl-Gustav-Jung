import { Pressable, StyleSheet, Text, View } from 'react-native';
import { StudioAvatar } from './StudioAvatar';
import { renderHighlightedText } from '../lib/highlightQuery';
import { colors, typography } from '../theme/colors';
import { zh } from '../locales/zh-CN';

type Props = {
  title: string;
  preview: string;
  query: string;
  timeLabel: string;
  matchCount: number;
  avatarSeed: string;
  onPress: () => void;
};

/** 微信式聊天记录搜索结果行 */
export function StudioSearchMessageRow({
  title,
  preview,
  query,
  timeLabel,
  matchCount,
  avatarSeed,
  onPress,
}: Props) {
  return (
    <Pressable style={styles.row} onPress={onPress}>
      <StudioAvatar name={title} seed={avatarSeed} size={48} />
      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          <Text style={styles.time}>{timeLabel}</Text>
        </View>
        <View style={styles.previewWrap}>
          {renderHighlightedText(preview, query, styles.preview, styles.highlight)}
        </View>
        {matchCount > 1 ? (
          <Text style={styles.countLine}>{zh.studio.searchMessageCount(matchCount)}</Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E7E7E7',
  },
  body: {
    flex: 1,
    marginLeft: 12,
    minWidth: 0,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  title: {
    flex: 1,
    fontSize: typography.body,
    fontWeight: '600',
    color: colors.text,
    marginRight: 8,
  },
  time: {
    fontSize: typography.small,
    color: colors.textMuted,
    flexShrink: 0,
  },
  previewWrap: {
    marginBottom: 2,
  },
  preview: {
    fontSize: typography.body,
    lineHeight: typography.bodyLineHeight,
    color: '#666666',
  },
  highlight: {
    color: '#07C160',
    fontWeight: '600',
  },
  countLine: {
    marginTop: 4,
    fontSize: typography.small,
    color: '#07C160',
  },
});
