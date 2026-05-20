import { Pressable, StyleSheet, Text, View } from 'react-native';
import { StudioAvatar } from './StudioAvatar';
import { formatChatListTime } from '../lib/formatChatListTime';
import { typography } from '../theme/colors';
import { wechat } from '../theme/wechat';

type Props = {
  title: string;
  preview: string;
  avatarName: string;
  avatarSeed: string;
  time?: string;
  pinned?: boolean;
  onPress: () => void;
  onLongPress?: () => void;
};

export function StudioChatListRow({
  title,
  preview,
  avatarName,
  avatarSeed,
  time,
  pinned,
  onPress,
  onLongPress,
}: Props) {
  return (
    <Pressable
      style={[styles.row, pinned && styles.rowPinned]}
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="button"
    >
      <StudioAvatar name={avatarName} seed={avatarSeed} size={52} />
      <View style={styles.body}>
        <View style={styles.top}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          {time ? <Text style={styles.time}>{formatChatListTime(time)}</Text> : null}
        </View>
        <Text style={styles.preview} numberOfLines={1}>
          {preview}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 11,
    minHeight: wechat.rowMinHeightWithSubtitle,
    backgroundColor: wechat.cellBg,
  },
  rowPinned: {
    backgroundColor: wechat.navBg,
  },
  body: { flex: 1, marginLeft: 12, minWidth: 0 },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  title: {
    flex: 1,
    fontSize: wechat.listTitleSize,
    fontWeight: '500',
    color: wechat.textPrimary,
    marginRight: 8,
  },
  time: {
    fontSize: wechat.listTimeSize,
    color: wechat.textTertiary,
  },
  preview: {
    fontSize: wechat.listSubtitleSize,
    color: wechat.textSecondary,
    lineHeight: typography.listSubtitleLineHeight,
  },
});
