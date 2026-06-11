/**
 * M7 T10：群聊 ask_user 提示卡。
 *
 * 数据双源：
 *   1. message payload.askUser（原始问题文本 + openedForAll 初始值）
 *   2. useAgentRunPoll(runId) 拉到的最新 run（动态 askUserOpenedForAllAt /
 *      askUserTargetUserId / pendingUserPrompt）
 *
 * 输入框可见性：
 *   - currentUserId === askUserTargetUserId → 始终可见
 *   - askUserOpenedForAllAt 非空 → 任意群成员可见
 *   - 否则隐藏（仅显示"请 @target 回答 + 30s 倒计时"）
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useAgentRunPoll } from './hooks/useAgentRunPoll';
import { resumeAgentRun } from './agentApi';
import { useAuth } from '../../components/AuthGate';
import { appAlert } from '../../lib/appAlert';
import { colors } from '../../theme/colors';

export type AskUserPromptCardProps = {
  runId: string;
  /** message payload.askUser 提供初始值，等 useAgentRunPoll 拉到新数据后覆盖 */
  initial: {
    question: string;
    target: string;
    openedForAll: boolean;
  };
};

export function AskUserPromptCard(props: AskUserPromptCardProps) {
  const { runId, initial } = props;
  const { run } = useAgentRunPoll(runId);
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [input, setInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // state 异步刷新堵不住同帧双击(闭包里 submitting 仍是 false),用 ref 做同步守卫
  const submittingRef = useRef(false);

  const question = run?.pendingUserPrompt ?? initial.question;
  const target = run?.askUserTargetUserId ?? initial.target;
  const openedForAll = !!run?.askUserOpenedForAllAt || initial.openedForAll;

  // 30s 倒计时
  const startedAtMs = run?.askUserStartedAt
    ? new Date(run.askUserStartedAt).getTime()
    : 0;
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const remainSec = useMemo(() => {
    if (!startedAtMs || openedForAll) return 0;
    return Math.max(0, Math.ceil((startedAtMs + 30_000 - now) / 1000));
  }, [startedAtMs, openedForAll, now]);

  const canAnswer = userId === target || openedForAll;

  const onSubmit = async () => {
    const trimmed = input.trim();
    if (!trimmed || submittingRef.current || !userId) return; // 未登录直接挡掉，避免 403
    submittingRef.current = true;
    setSubmitting(true);
    try {
      await resumeAgentRun(runId, trimmed);
      setInput('');
    } catch (e) {
      appAlert('提交失败', String(e));
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 12, marginVertical: 6 }}>
      <Text style={{ fontSize: 14, marginBottom: 6 }}>{question}</Text>
      <Text style={{ fontSize: 12, color: colors.textMuted, marginBottom: 6 }}>
        {openedForAll
          ? '任意群成员可回答'
          : startedAtMs
            ? `请 @${target} 回答 · ${remainSec}s 后开放`
            : `请 @${target} 回答`}
      </Text>
      {canAnswer ? (
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder="输入你的回答…"
            style={{ flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 6, padding: 6 }}
            editable={!submitting}
          />
          <TouchableOpacity
            onPress={onSubmit}
            disabled={submitting || input.trim().length === 0}
            style={{ marginLeft: 8, padding: 6, backgroundColor: colors.link, borderRadius: 6 }}
          >
            <Text style={{ color: colors.onPrimary }}>{submitting ? '提交中' : '提交'}</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
}
