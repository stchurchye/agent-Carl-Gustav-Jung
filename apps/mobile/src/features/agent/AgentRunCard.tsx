import React from 'react';
import { View, Text, TouchableOpacity, Alert } from 'react-native';
import { useAgentRunPoll as useAgentRunSubscription } from './hooks/useAgentRunPoll';
import {
  approveAgentRun,
  cancelAgentRun,
  denyAgentRun,
  steerAgentRun,
} from './agentApi';
import type { AgentRunStatus } from './types';
import { AgentTodoList } from './AgentTodoList';
import { AgentStepList } from './AgentStepList';
import { AgentSteerInput } from './AgentSteerInput';

const TERMINAL: AgentRunStatus[] = [
  'completed',
  'failed',
  'cancelled',
  'budget_exhausted',
];

const STATUS_LABEL: Record<AgentRunStatus, string> = {
  draft: '准备中',
  awaiting_confirm: '等待确认',
  planning: '规划中',
  running: '运行中',
  awaiting_approval: '等待授权',
  replanning: '重新规划',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
  budget_exhausted: '预算耗尽',
};

export function AgentRunCard({ runId }: { runId: string }) {
  const { run, steps, connected } = useAgentRunSubscription(runId);

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
        <AgentStepList steps={steps} />
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
    </View>
  );
}
