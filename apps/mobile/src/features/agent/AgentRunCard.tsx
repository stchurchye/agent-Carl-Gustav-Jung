import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Alert, Linking } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useNavigation } from '@react-navigation/native';
import { navigateBrainTab } from '../../lib/navigateBrain';
import { useAgentRunPoll as useAgentRunSubscription } from './hooks/useAgentRunPoll';
import {
  approveAgentRun,
  cancelAgentRun,
  denyAgentRun,
  resumeAgentRun,
  retryAgentRun,
  steerAgentRun,
} from './agentApi';
import type { AgentNoticeSeverity, AgentRunStatus, RunArtifact } from './types';
import { AgentTodoList } from './AgentTodoList';
import { AgentStepList } from './AgentStepList';
import { AgentSteerInput } from './AgentSteerInput';
import { agentLlmDisplayName } from '@xzz/shared';

const NOTICE_BG: Record<AgentNoticeSeverity, string> = {
  info: '#e6f4ff',
  warn: '#fff8e0',
  error: '#fff0f0',
};
const NOTICE_FG: Record<AgentNoticeSeverity, string> = {
  info: '#055',
  warn: '#a60',
  error: '#a00',
};
const NOTICE_GLYPH: Record<AgentNoticeSeverity, string> = {
  info: 'i',
  warn: '!',
  error: '!!',
};

const TERMINAL: AgentRunStatus[] = [
  'completed',
  'failed',
  'cancelled',
  'budget_exhausted',
];

const STATUS_LABEL: Record<AgentRunStatus, string> = {
  draft: '准备中',
  planning: '规划中',
  running: '运行中',
  awaiting_approval: '等待授权',
  awaiting_user_input: '等待输入',
  replanning: '重新规划',
  queued: '排队中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
  budget_exhausted: '预算耗尽',
};

function formatCny(n?: number): string {
  if (!n || n <= 0) return '¥0.00';
  if (n < 0.01) return `¥${n.toFixed(4)}`;
  return `¥${n.toFixed(2)}`;
}

function formatSummaryLine(
  summary: { stepCount: number; toolCount: number; refCount: number } | null | undefined,
  costCny: number | undefined,
): string {
  const cost = formatCny(costCny);
  if (!summary) return `${cost} 估算`;
  const parts: string[] = [];
  parts.push(`${summary.stepCount} 步`);
  if (summary.toolCount > 0) parts.push(`${summary.toolCount} 工具`);
  if (summary.refCount > 0) parts.push(`${summary.refCount} 引用`);
  parts.push(`${cost} 估算`);
  return parts.join(' · ');
}

const LONG_CONTENT_THRESHOLD = 200;

function ArtifactBlock({
  artifact,
  onJumpToStep,
}: {
  artifact: RunArtifact;
  onJumpToStep?: (stepId: string) => void;
}) {
  const navigation = useNavigation<any>();
  const [expanded, setExpanded] = useState(false);
  const isLong = artifact.finalContent.length > LONG_CONTENT_THRESHOLD;

  const producedAt = new Date(artifact.producedAt).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <View
      style={{
        marginTop: 8,
        padding: 10,
        borderRadius: 8,
        backgroundColor: '#f0f7f0',
      }}
    >
      <Text style={{ fontSize: 11, fontWeight: '600', opacity: 0.6, marginBottom: 6 }}>
        产物
      </Text>

      <Text
        style={{ fontSize: 13, lineHeight: 20, color: '#1a1a1a' }}
        numberOfLines={expanded ? undefined : 5}
      >
        {artifact.finalContent}
      </Text>

      {isLong ? (
        <TouchableOpacity
          onPress={() => setExpanded((v) => !v)}
          style={{ marginTop: 4 }}
        >
          <Text style={{ fontSize: 12, color: '#0a6' }}>{expanded ? '收起' : '展开'}</Text>
        </TouchableOpacity>
      ) : null}

      {artifact.refs.length > 0 ? (
        <View style={{ marginTop: 8, paddingTop: 8, borderTopWidth: 0.5, borderTopColor: '#c8dcc8' }}>
          <Text style={{ fontSize: 11, opacity: 0.55, marginBottom: 4 }}>
            引用 ({artifact.refs.length})：
          </Text>
          {artifact.refs.map((ref) => (
            <TouchableOpacity
              key={ref.id}
              onPress={() => {
                if (ref.kind === 'url') {
                  Linking.openURL(ref.id).catch(() => {});
                } else if (ref.kind === 'diagram') {
                  Alert.alert(
                    '图表',
                    `${ref.label ?? '未命名图表'}\n请在下方步骤列表中查找 id: ${ref.id}`,
                  );
                } else if (ref.kind === 'document') {
                  navigateBrainTab(navigation, 'SettingsDocuments', {
                    scope: 'visible',
                    highlightId: ref.id,
                  });
                } else if (ref.kind === 'magi_card') {
                  Alert.alert('MAGI 卡片', `${ref.label ?? ref.id}\nID: ${ref.id}`);
                }
              }}
            >
              <Text style={{ fontSize: 12, color: '#0a6', marginBottom: 2 }}>
                • [{ref.kind}] {ref.label ?? ref.id}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}

      <View
        style={{
          marginTop: 8,
          paddingTop: 8,
          borderTopWidth: 0.5,
          borderTopColor: '#c8dcc8',
          flexDirection: 'row',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 6,
        }}
      >
        <TouchableOpacity
          onPress={async () => {
            await Clipboard.setStringAsync(artifact.finalContent);
          }}
        >
          <Text style={{ fontSize: 12, color: '#0a6' }}>复制全文</Text>
        </TouchableOpacity>
        <Text style={{ fontSize: 12, opacity: 0.45 }}>·</Text>
        <Text style={{ fontSize: 12, opacity: 0.45 }}>产出于 {producedAt}</Text>
      </View>
    </View>
  );
}

export function AgentRunCard({
  runId,
  onRetry,
}: {
  runId: string;
  /**
   * M1d Task 3：重试成功后，上层调用方拿到新 runId 后可以决定如何处理，
   * 通常是刷新会话消息列表，让新 placeholder 上挂另一个 AgentRunCard。
   */
  onRetry?: (newRunId: string) => void | Promise<void>;
}) {
  const { run, steps, notices, connected } = useAgentRunSubscription(runId);

  if (!run) {
    return (
      <View style={{ padding: 10, borderRadius: 8, backgroundColor: '#f4f4f4', marginVertical: 6 }}>
        <Text>加载 agent run…</Text>
      </View>
    );
  }

  const terminal = TERMINAL.includes(run.status);
  const awaitingApproval = run.status === 'awaiting_approval';

  return (
    <View
      style={{
        padding: 10,
        borderRadius: 8,
        marginVertical: 6,
        backgroundColor: terminal ? '#f4f4f4' : '#eef4ff',
      }}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ fontWeight: '600' }}>
          Agent · {STATUS_LABEL[run.status] ?? run.status}
          {!terminal && connected ? ' · live' : ''}
        </Text>
        {!terminal ? (
          <TouchableOpacity onPress={() => cancelAgentRun(runId).catch(() => {})}>
            <Text style={{ color: '#c33' }}>取消</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <Text style={{ fontSize: 12, opacity: 0.6, marginTop: 4 }} numberOfLines={3}>
        {run.inputText}
      </Text>
      {/* M1e Task 12: 任务面板顶部铭牌 —— 让用户知道这条 run 用了哪个 provider/model，
          retry / 切模型时是否生效就一目了然。 */}
      <Text style={{ fontSize: 11, opacity: 0.45, marginTop: 2 }}>
        by {agentLlmDisplayName(run.providerId, run.modelId)}
      </Text>

      {notices && notices.length > 0 ? (
        <View style={{ marginTop: 8 }}>
          {notices.map((n) => (
            <View
              key={n.id}
              style={{
                marginTop: 4,
                paddingVertical: 6,
                paddingHorizontal: 10,
                borderRadius: 6,
                backgroundColor: NOTICE_BG[n.severity],
              }}
            >
              <Text style={{ fontSize: 12, color: NOTICE_FG[n.severity], fontWeight: '600' }}>
                [{NOTICE_GLYPH[n.severity]}] {n.message}
              </Text>
              <Text style={{ fontSize: 10, color: '#888', marginTop: 2 }}>
                {n.code}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      <View style={{ marginTop: 8 }}>
        <AgentTodoList todos={run.todos ?? []} />
      </View>

      {run.status === 'budget_exhausted' && run.usage && run.budget ? (
        <View
          style={{
            marginTop: 8,
            paddingVertical: 6,
            paddingHorizontal: 10,
            borderRadius: 6,
            backgroundColor: '#fff0f0',
          }}
        >
          <Text style={{ fontSize: 12, color: '#a00', fontWeight: '600' }}>
            预算已用尽
          </Text>
          <Text style={{ fontSize: 12, color: '#555', marginTop: 2 }}>
            步骤 {run.usage.steps}/{run.budget.maxSteps} · tokens{' '}
            {run.usage.tokens}/{run.budget.maxTokens} · 用时{' '}
            {run.usage.elapsedSeconds}s/{run.budget.maxSeconds}s
          </Text>
        </View>
      ) : null}

      {awaitingApproval ? (
        <View
          style={{
            marginTop: 8,
            paddingVertical: 8,
            paddingHorizontal: 10,
            borderRadius: 6,
            backgroundColor: '#fff7e0',
            flexDirection: 'row',
            alignItems: 'center',
          }}
        >
          <Text style={{ flex: 1 }}>
            等待授权工具：{run.pendingApprovalToolName ?? '?'}
          </Text>
          <TouchableOpacity
            onPress={() =>
              approveAgentRun(runId).catch((e) => Alert.alert('授权失败', String(e)))
            }
          >
            <Text style={{ color: '#393', marginRight: 16 }}>同意</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() =>
              denyAgentRun(runId).catch((e) => Alert.alert('拒绝失败', String(e)))
            }
          >
            <Text style={{ color: '#c33' }}>拒绝</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <View style={{ marginTop: 8 }}>
        <AgentStepList
          steps={steps}
          run={run}
          resumeRun={resumeAgentRun}
        />
      </View>

      {!terminal ? (
        <AgentSteerInput
          disabled={awaitingApproval}
          placeholder={awaitingApproval ? '先处理授权再发送 steer' : undefined}
          onSubmit={(text) =>
            steerAgentRun(runId, text).catch((e) => Alert.alert('steer 失败', String(e)))
          }
        />
      ) : null}

      {terminal ? (
        <View style={{ marginTop: 8 }}>
          <Text style={{ fontSize: 11, opacity: 0.55 }}>
            {formatSummaryLine(run.summary, run.usage?.costCny)}
          </Text>
        </View>
      ) : null}

      {terminal && run.artifact ? (
        <ArtifactBlock artifact={run.artifact} onJumpToStep={undefined} />
      ) : null}

      {terminal && run.status !== 'completed' ? (
        <View style={{ marginTop: 8, flexDirection: 'row', justifyContent: 'flex-end' }}>
          <TouchableOpacity
            onPress={async () => {
              try {
                const { runId: newId } = await retryAgentRun(runId);
                await onRetry?.(newId);
              } catch (e) {
                Alert.alert('重试失败', String(e));
              }
            }}
          >
            <Text style={{ color: '#0a6' }}>再试一次</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
}
