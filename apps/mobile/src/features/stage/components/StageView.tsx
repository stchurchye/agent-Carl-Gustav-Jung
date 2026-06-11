import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { CharacterMotion, CompiledCharacter } from '../../../pixel/types';
import { arrangeActors, selectStageDialog } from '../stageDialog';
import type { StageActor, StageLine } from '../stageTypes';
import { ActorSlot } from './ActorSlot';
import { AgentBusyDot } from './AgentBusyDot';
import { AgentSpeechBubble } from './AgentSpeechBubble';
import { SpeechBubble } from './SpeechBubble';

export type ResolvedCharacter = {
  character: CompiledCharacter;
  motion: CharacterMotion;
  /** 摸一摸彩蛋:连点按 物种×性格 轮换(ActorSlot 用 count % len 取) */
  reactions: string[];
};

type Props = {
  actors: StageActor[];
  lines: StageLine[];
  resolveCharacter: (actor: StageActor) => ResolvedCharacter;
  selfUserId?: string;
  maxSlots?: number;
  /** 大气泡最大高(屏高的 ~42% 由 screen 算好传入) */
  maxBubbleHeight: number;
  onActorPress: (actor: StageActor) => void;
  onBubblePress?: (line: StageLine) => void;
  onRetry?: (line: StageLine) => void;
  /** +N 折叠堆点击(v1 直接开历史浮层) */
  onOverflowPress?: () => void;
};

const SPRITE_SIZE = 88;

/**
 * 像素舞台:上方大对话框(一次只一条,完整展示框内滚动)+ 上一句迷你气泡 + 底部角色排。
 * 纯展示组件:数据由 adapter 归一,发送/轮询等逻辑全在 screen 层。
 */
export function StageView({
  actors,
  lines,
  resolveCharacter,
  selfUserId,
  maxSlots = 4,
  maxBubbleHeight,
  onActorPress,
  onBubblePress,
  onRetry,
  onOverflowPress,
}: Props) {
  const dialog = selectStageDialog(lines);
  const arranged = arrangeActors(actors, lines, maxSlots);
  const actorById = new Map(actors.map((a) => [a.id, a]));
  const current = dialog.current;
  const previous = dialog.previous;
  const currentActor = current ? actorById.get(current.actorId) : null;
  const previousActor = previous ? actorById.get(previous.actorId) : null;

  const lastSystem = [...lines].reverse().find((l) => l.kind === 'system');

  const attentionForActor = (actorId: string): boolean => {
    // 该角色最新一条 agent 行且在等待输入/授权时,由气泡 tone 表达;
    // 角标只在 current 是它的 agent 行时点亮(订阅在气泡叶子,不重复订阅)
    return current?.actorId === actorId && current.kind === 'agent';
  };

  return (
    <View style={styles.stage} testID="stage-view">
      <View style={styles.bubbleArea}>
        {current ? (
          current.kind === 'agent' && current.agentRunId ? (
            <AgentSpeechBubble
              runId={current.agentRunId}
              speakerName={currentActor?.name}
              selfUserId={selfUserId}
              maxHeight={maxBubbleHeight}
              onPress={() => onBubblePress?.(current)}
              testID="stage-current-bubble"
            />
          ) : (
            <SpeechBubble
              text={current.text}
              speakerName={currentActor?.name}
              tone={current.kind === 'error' ? 'error' : 'normal'}
              pending={current.kind === 'pending'}
              followStream={current.kind === 'pending'}
              maxHeight={maxBubbleHeight}
              onRetry={current.kind === 'error' && onRetry ? () => onRetry(current) : undefined}
              onPress={() => onBubblePress?.(current)}
              testID="stage-current-bubble"
            />
          )
        ) : null}
        {previous ? (
          <View style={styles.prevWrap}>
            <SpeechBubble
              text={previous.text}
              speakerName={previousActor?.name}
              dimmed
              maxHeight={84}
              onPress={() => onBubblePress?.(previous)}
              testID="stage-previous-bubble"
            />
          </View>
        ) : null}
      </View>

      {lastSystem ? (
        <Text style={styles.ticker} numberOfLines={1} testID="stage-system-ticker">
          {lastSystem.text}
        </Text>
      ) : null}

      <View style={styles.actorRow}>
        {arranged.visible.map((actor) => {
          const resolved = resolveCharacter(actor);
          // 非当前说话者的最新一条是 agent 行 → 头顶迷你状态点(跑完自动消失)
          const latestLine = [...lines].reverse().find(
            (l) => l.actorId === actor.id && l.kind !== 'system',
          );
          const busyRunId =
            current?.actorId !== actor.id && latestLine?.kind === 'agent'
              ? latestLine.agentRunId
              : undefined;
          return (
            <ActorSlot
              key={actor.id}
              actor={actor}
              character={resolved.character}
              motion={resolved.motion}
              reactions={resolved.reactions}
              busyProbe={
                busyRunId ? (
                  <AgentBusyDot runId={busyRunId} testID={`busy-${actor.id}`} />
                ) : null
              }
              size={SPRITE_SIZE}
              speaking={current?.actorId === actor.id}
              attention={attentionForActor(actor.id)}
              onPress={onActorPress}
              testID={`actor-${actor.id}`}
            />
          );
        })}
        {arranged.overflow.length > 0 ? (
          <Pressable style={styles.overflow} onPress={onOverflowPress} testID="stage-overflow">
            <Text style={styles.overflowText}>+{arranged.overflow.length}</Text>
          </Pressable>
        ) : null}
      </View>
      <View style={styles.ground} />
    </View>
  );
}

const styles = StyleSheet.create({
  stage: { flex: 1, paddingHorizontal: 12, paddingTop: 8 },
  bubbleArea: { flexGrow: 0, flexShrink: 1 },
  prevWrap: { marginTop: 6 },
  ticker: {
    marginTop: 6,
    fontSize: 11,
    color: '#8A8377',
    textAlign: 'center',
  },
  actorRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    marginTop: 'auto',
    paddingBottom: 2,
  },
  overflow: {
    width: 40,
    height: 40,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: '#3D3229',
    backgroundColor: '#F0EEE6',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 6,
    alignSelf: 'flex-end',
    marginBottom: 24,
  },
  overflowText: { fontWeight: '800', color: '#3D3229' },
  ground: {
    height: 10,
    marginHorizontal: -12,
    backgroundColor: '#E5DDC9',
    borderTopWidth: 2,
    borderTopColor: '#3D3229',
  },
});
