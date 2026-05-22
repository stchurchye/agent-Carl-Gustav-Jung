import React from 'react';
import { ScrollView, View, Text } from 'react-native';
import type { AgentRun, AgentStep } from './types';
import AskUserPrompt from '../../components/AskUserPrompt';
import DeepResearchReport from '../../components/DeepResearchReport';

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

type DiagramStepResult = {
  ok: boolean;
  diagramId: string;
  title: string;
  validationWarnings: string[];
};

function extractDiagramResult(output: unknown): DiagramStepResult | null {
  if (!output || typeof output !== 'object') return null;
  const wrapped = output as { result?: unknown };
  const raw = wrapped.result ?? output;
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<DiagramStepResult>;
  if (typeof r.ok !== 'boolean' || typeof r.diagramId !== 'string') return null;
  return {
    ok: r.ok,
    diagramId: r.diagramId,
    title: typeof r.title === 'string' ? r.title : '',
    validationWarnings: Array.isArray(r.validationWarnings) ? r.validationWarnings : [],
  };
}

function DiagramStepCard({ step }: { step: AgentStep }) {
  const result = extractDiagramResult(step.output);
  if (!result) return null;
  if (!result.ok) return null;
  return (
    <View
      style={{
        marginTop: 4,
        padding: 8,
        backgroundColor: '#f0f7ff',
        borderRadius: 6,
        borderWidth: 1,
        borderColor: '#cde',
      }}
    >
      <Text style={{ fontSize: 12, fontWeight: '600', color: '#336' }}>
        📊 {result.title || '图表'}
      </Text>
      <Text style={{ fontSize: 10, color: '#669', marginTop: 2 }}>
        id: {result.diagramId}
      </Text>
      {result.validationWarnings.length > 0 ? (
        <Text style={{ fontSize: 10, color: '#a60', marginTop: 2 }}>
          ⚠ {result.validationWarnings[0]}
        </Text>
      ) : null}
    </View>
  );
}

type Props = {
  steps: AgentStep[];
  run?: AgentRun;
  resumeRun?: (runId: string, userInput: string) => Promise<void>;
  onRefresh?: () => void;
};

export function AgentStepList({ steps, run, resumeRun, onRefresh }: Props) {
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
          {s.toolName === 'render_diagram' && s.kind === 'tool_call' ? (
            <DiagramStepCard step={s} />
          ) : null}
          {s.toolName === 'ask_user' &&
          s.kind === 'tool_call' &&
          run?.status === 'awaiting_user_input' &&
          resumeRun ? (
            <AskUserPrompt
              runId={s.runId}
              question={
                // run.pendingUserPrompt 是服务端权威来源；fallback 到 step.input.question 兼容老数据。
                run?.pendingUserPrompt ??
                (s.input as { question?: string } | null)?.question ??
                '请回答：'
              }
              options={(s.input as { options?: string[] } | null)?.options}
              resumeRun={resumeRun}
              onResumed={onRefresh}
            />
          ) : null}
          {s.toolName === 'deep_research' && s.kind === 'tool_call' ? (
            (() => {
              // tool results are wrapped: s.output = { result: toolHandlerOutput, retried: boolean }
              const raw = s.output as {
                result?: {
                  ok?: boolean;
                  report?: string;
                  citations?: Array<{ kind: string; id: string; label?: string }>;
                  stepsUsed?: number;
                };
              } | null;
              const out = raw?.result ?? null;
              const inp = s.input as { question?: string } | null;
              if (!out?.ok) return null;
              return (
                <DeepResearchReport
                  question={inp?.question ?? '子任务'}
                  report={out.report ?? ''}
                  citations={out.citations}
                  stepsUsed={out.stepsUsed ?? 0}
                />
              );
            })()
          ) : null}
        </View>
      ))}
    </ScrollView>
  );
}
