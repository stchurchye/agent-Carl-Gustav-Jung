import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { presetDogForSeed, type PixelAvatarSettings } from '@xzz/shared';
import { buildCatCharacter } from '../pixel/buildCat';
import { buildDogCharacter } from '../pixel/buildDog';
import { PixelSprite } from './pixel/PixelSprite';
import { ModelProviderChip } from './ModelProviderChip';
import { formatChatListTime } from '../lib/formatChatListTime';
import { wechat } from '../theme/wechat';
import { brainTokens } from '../theme/brainTokens';
import { zh } from '../locales/zh-CN';

export type WorkbenchTopic = { id: string; title: string; preview: string; time?: string };

type Props = {
  /** 当前活体狗名(persona),显示在头部一行 */
  assistantName: string;
  avatar: PixelAvatarSettings | null;
  /** 未领养时的兜底狗种子,传 user.id 与其它屏一致 */
  seed?: string;
  /** 当前私聊模型 id,头部芯片显示并可点切换 */
  modelId: string;
  topics: WorkbenchTopic[];
  onPressTopic: (id: string) => void;
  onNewChat: () => void;
  onPressModel: () => void;
};

/**
 * 「我的 Bow Wow」工作台卡片 —— Claude Code 分支风:
 * 对话本就是「我和 bow wow」,头像/名字只在头部出现一次;下面用分支线(├─/└─)
 * 紧凑列出各个话题,不再每行重复狗头像。头部一行:狗 + 名字 + 模型芯片 + 对话数 + 新建。
 */
export function BowWowWorkbenchCard({
  assistantName,
  avatar,
  seed,
  modelId,
  topics,
  onPressTopic,
  onNewChat,
  onPressModel,
}: Props) {
  const sprite = useMemo(() => {
    if (avatar?.species === 'cat' && avatar.cat) return buildCatCharacter(avatar.cat).still;
    return buildDogCharacter(avatar?.dog ?? presetDogForSeed(seed ?? 'bowwow').dog).still;
  }, [avatar, seed]);

  const isEmpty = topics.length === 0;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View testID="bowwow-header-avatar" style={styles.avatar}>
          <PixelSprite sprite={sprite} size={44} />
        </View>
        <View style={styles.headerMid}>
          <View style={styles.nameRow}>
            <Text style={styles.name} numberOfLines={1}>
              {assistantName}
            </Text>
            <ModelProviderChip
              modelId={modelId}
              onPress={onPressModel}
              accessibilityLabel={zh.chat.changeLlmModel}
            />
          </View>
          <Text style={styles.count}>{zh.studio.conversationCount(topics.length)}</Text>
        </View>
        <Pressable
          testID="bowwow-new-chat"
          onPress={onNewChat}
          hitSlop={10}
          style={({ pressed }) => [styles.newBtn, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={zh.chat.newSession}
        >
          <Text style={styles.newPlus}>＋</Text>
        </Pressable>
      </View>

      <View style={styles.branches}>
        {isEmpty ? (
          <Pressable
            testID="bowwow-empty-newchat"
            onPress={onNewChat}
            style={({ pressed }) => [styles.branchRow, pressed && styles.pressed]}
            accessibilityRole="button"
          >
            <Text style={styles.connector}>└─</Text>
            <Text style={[styles.title, styles.cta]} numberOfLines={1}>
              {zh.chat.newSession}
            </Text>
          </Pressable>
        ) : (
          topics.map((t, i) => {
            const last = i === topics.length - 1;
            return (
              <Pressable
                key={t.id}
                testID={`workbench-topic-${t.id}`}
                onPress={() => onPressTopic(t.id)}
                style={({ pressed }) => [
                  styles.branchRow,
                  i > 0 && styles.branchDivider,
                  pressed && styles.pressed,
                ]}
                accessibilityRole="button"
              >
                <Text style={styles.connector}>{last ? '└─' : '├─'}</Text>
                <Text style={styles.title} numberOfLines={1}>
                  {t.title}
                </Text>
                {t.preview ? (
                  <Text style={styles.preview} numberOfLines={1}>
                    {`·  ${t.preview}`}
                  </Text>
                ) : null}
                {t.time ? <Text style={styles.time}>{formatChatListTime(t.time)}</Text> : null}
              </Pressable>
            );
          })
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: wechat.cellBg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: brainTokens.border,
    borderRadius: 12,
    marginHorizontal: 12,
    marginTop: 8,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: brainTokens.border,
  },
  avatar: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerMid: { flex: 1, marginLeft: 11, minWidth: 0 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  name: {
    flexShrink: 1,
    fontSize: 16,
    fontWeight: '500',
    color: wechat.textPrimary,
  },
  count: { fontSize: 12, color: wechat.textTertiary, marginTop: 2 },
  newBtn: { paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center' },
  newPlus: { fontSize: 24, fontWeight: '300', color: brainTokens.accent, lineHeight: 26 },
  pressed: { opacity: 0.55 },

  branches: { paddingHorizontal: 12, paddingVertical: 2 },
  branchRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  branchDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#F4F1E9',
  },
  connector: {
    fontFamily: 'Courier',
    fontSize: 13,
    color: '#C9C5BA',
    marginRight: 8,
  },
  title: {
    flexShrink: 0,
    maxWidth: '52%',
    fontSize: 14,
    color: wechat.textPrimary,
  },
  cta: { color: brainTokens.accent, flexShrink: 1, maxWidth: undefined },
  preview: {
    flex: 1,
    fontSize: 14,
    color: wechat.textTertiary,
    marginLeft: 6,
  },
  time: { fontSize: 12, color: wechat.textTertiary, marginLeft: 8 },
});
