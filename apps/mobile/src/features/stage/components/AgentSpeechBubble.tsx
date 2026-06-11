import React, { useEffect, useState } from 'react';
import { useAgentRunPoll } from '../../agent/hooks/useAgentRunPoll';
import { isTerminalRunStatus } from '../../agent/types';
import { runStageText } from '../agentStageText';
import { SpeechBubble } from './SpeechBubble';

type Props = {
  runId: string;
  speakerName?: string;
  selfUserId?: string;
  targetUserName?: string;
  maxHeight: number;
  dimmed?: boolean;
  /** 点气泡 → 打开历史浮层并定位到 AgentRunCard(授权/steer 在卡内) */
  onPress?: () => void;
  testID?: string;
};

/**
 * 狗跑任务时的台词气泡:订阅下沉到叶子(runStore 共享 long-poll),
 * 非终态 1s tick 刷新耗时;完整步骤/todo/授权按钮在浮层的 AgentRunCard。
 */
export function AgentSpeechBubble({
  runId,
  speakerName,
  selfUserId,
  targetUserName,
  maxHeight,
  dimmed,
  onPress,
  testID,
}: Props) {
  const snap = useAgentRunPoll(runId);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const active = !!snap.run && !isTerminalRunStatus(snap.run.status) && !snap.missing;
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);

  const line = runStageText(snap.run, snap.steps, {
    nowMs,
    missing: snap.missing,
    selfUserId,
    targetUserName,
  });

  return (
    <SpeechBubble
      text={line.text}
      tone={line.tone}
      speakerName={speakerName}
      pending={active && line.tone === 'normal'}
      maxHeight={maxHeight}
      dimmed={dimmed}
      onPress={onPress}
      testID={testID}
    />
  );
}
