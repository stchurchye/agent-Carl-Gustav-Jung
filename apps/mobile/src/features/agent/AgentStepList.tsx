import React from 'react';
import { ScrollView, View, Text } from 'react-native';
import type { AgentStep } from './types';

const KIND_LABEL: Partial<Record<AgentStep['kind'], string>> = {
  plan: '规划',
  tool_call: '调用',
  tool_error: '失败',
  observe: '观察',
  critique: '复盘',
  reply: '回复',
  steer: '插话',
  approval_request: '待授权',
  approval_grant: '已授权',
  approval_deny: '已拒绝',
  approval_timeout: '授权超时',
};

export function AgentStepList({ steps }: { steps: AgentStep[] }) {
  if (!steps.length) return null;
  return (
    <ScrollView style={{ maxHeight: 200 }}>
      {steps.map((s) => (
        <View key={s.id} style={{ paddingVertical: 2 }}>
          <Text style={{ fontSize: 12, opacity: 0.6 }}>
            #{s.idx} {KIND_LABEL[s.kind] ?? s.kind}
            {s.toolName ? ` · ${s.toolName}` : ''}
          </Text>
          {s.error ? (
            <Text style={{ fontSize: 11, color: '#c33', marginTop: 2 }}>{s.error}</Text>
          ) : null}
        </View>
      ))}
    </ScrollView>
  );
}
