import { Pressable, StyleSheet, Text, View } from 'react-native';
import { presetDogForSeed, type PixelAvatarSettings } from '@xzz/shared';
import { useMemo } from 'react';
import { buildCatCharacter } from '../pixel/buildCat';
import { PixelSprite } from './pixel/PixelSprite';
import { buildDogCharacter } from '../pixel/buildDog';
import { formatChatListTime } from '../lib/formatChatListTime';
import { typography } from '../theme/colors';
import { wechat } from '../theme/wechat';
import { brainTokens } from '../theme/brainTokens';

type Props = {
  title: string;
  preview: string;
  avatar: PixelAvatarSettings | null;
  /** 未领养(avatar 为空)时的默认狗种子;传 user.id 以与 BrainHub 等其它屏的兜底狗一致。 */
  seed?: string;
  time?: string;
  /** 新建会话行:狗角上挂个像素「+」角标 */
  isNew?: boolean;
  onPress: () => void;
  onLongPress?: () => void;
};

/**
 * 「我的 Bow Wow」专用会话行:这里永远只有我和我的狗,
 * 不用通用头像——直接是自己的像素狗,最近一句话装在狗的小对话泡里。
 */
export function BowWowSessionRow({ title, preview, avatar, seed, time, isNew, onPress, onLongPress }: Props) {
  const sprite = useMemo(() => {
    if (avatar?.species === 'cat' && avatar.cat) return buildCatCharacter(avatar.cat).still;
    return buildDogCharacter(avatar?.dog ?? presetDogForSeed(seed ?? 'bowwow').dog).still;
  }, [avatar, seed]);

  return (
    <Pressable style={styles.row} onPress={onPress} onLongPress={onLongPress} accessibilityRole="button">
      <View style={styles.dogWrap}>
        <PixelSprite sprite={sprite} size={48} />
        {isNew ? (
          <View style={styles.plusBadge}>
            <Text style={styles.plusText}>+</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.body}>
        <View style={styles.top}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          {time ? <Text style={styles.time}>{formatChatListTime(time)}</Text> : null}
        </View>
        {/* 狗的小对话泡:左下带一个像素「尾巴」方块 */}
        <View style={styles.bubbleWrap}>
          <View style={styles.bubbleTail} />
          <View style={styles.bubble}>
            <Text style={styles.preview} numberOfLines={1}>
              {preview}
            </Text>
          </View>
        </View>
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
  dogWrap: { width: 52, alignItems: 'center' },
  plusBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 18,
    height: 18,
    borderRadius: 3,
    backgroundColor: brainTokens.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  plusText: { color: '#fff', fontSize: 14, fontWeight: '800', lineHeight: 16 },
  body: { flex: 1, marginLeft: 12, minWidth: 0 },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 5,
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
  bubbleWrap: { flexDirection: 'row', alignItems: 'center' },
  bubbleTail: {
    width: 6,
    height: 6,
    backgroundColor: brainTokens.bgElevated,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: brainTokens.border,
    marginRight: -2,
  },
  bubble: {
    flexShrink: 1,
    backgroundColor: brainTokens.bgElevated,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: brainTokens.border,
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  preview: {
    fontSize: wechat.listSubtitleSize,
    color: wechat.textSecondary,
    lineHeight: typography.listSubtitleLineHeight,
  },
});
