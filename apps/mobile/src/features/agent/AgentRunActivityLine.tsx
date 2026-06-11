import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Text, View } from 'react-native';
import { colors } from '../../theme/colors';
import { isTerminalRunStatus } from './types';
import type { AgentRun, AgentStep } from './types';

/**
 * W1d 等待感:运行中的卡片顶部动态行 ——「呼吸点 + 正在做什么 + 已用时」。
 * 让"持续变化等待中"可感知:用户能看到 agent 当前阶段/工具与耗时,
 * 而不是一个静止的状态标签。终态与排队(queued 另有队列位置行)不渲染。
 */

function activityText(run: AgentRun, steps: AgentStep[]): string {
  switch (run.status) {
    case 'planning':
      return '正在规划';
    case 'replanning':
      return '正在重新规划';
    case 'awaiting_approval':
      return '等待你授权';
    case 'awaiting_user_input':
      return '等待你的回答';
    default: {
      const last = steps[steps.length - 1];
      if (last?.kind === 'tool_call' && last.toolName) return `正在调用 ${last.toolName}`;
      if (last?.kind === 'observe') return '正在整理结果';
      if (last?.kind === 'reply') return '正在撰写回复';
      return '正在执行';
    }
  }
}

function formatElapsed(fromIso: string): string {
  const ms = Math.max(0, Date.now() - new Date(fromIso).getTime());
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function BreathingDot() {
  const opacity = useRef(new Animated.Value(0.35)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 700,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.35,
          duration: 700,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return (
    <Animated.View
      style={{
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: colors.accent,
        opacity,
        marginRight: 6,
      }}
    />
  );
}

export function AgentRunActivityLine({ run, steps }: { run: AgentRun; steps: AgentStep[] }) {
  const active = !isTerminalRunStatus(run.status) && run.status !== 'queued';
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(timer);
  }, [active]);

  if (!active) return null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6 }}>
      <BreathingDot />
      <Text style={{ fontSize: 12, color: colors.textMuted }}>
        {activityText(run, steps)} · {formatElapsed(run.createdAt)}
      </Text>
    </View>
  );
}
