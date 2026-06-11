import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { navigateBrainTab } from '../../lib/navigateBrain';
import { colors } from '../../theme/colors';
import { isTerminalRunStatus } from './types';
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
  subagent_tool_denied: '子任务越权拦截',
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
        backgroundColor: colors.infoBg,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: colors.border,
      }}
    >
      <Text style={{ fontSize: 12, fontWeight: '600', color: colors.text }}>
        📊 {result.title || '图表'}
      </Text>
      <Text style={{ fontSize: 10, color: colors.textMuted, marginTop: 2 }}>
        id: {result.diagramId}
      </Text>
      {result.validationWarnings.length > 0 ? (
        <Text style={{ fontSize: 10, color: colors.warning, marginTop: 2 }}>
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
  /** 详情屏全量平铺;聊天卡(默认)运行中只显最近几步、终态折叠为摘要。 */
  expanded?: boolean;
};

/** 聊天卡运行中保留的最近步骤数(进度感够用,卡片不无限长高)。 */
const VISIBLE_ACTIVE_STEPS = 3;

/** 带富内容的步骤(报告/图表):终态折叠时也要保留展示。 */
function isRichStep(s: AgentStep): boolean {
  return s.kind === 'tool_call' && (s.toolName === 'deep_research' || s.toolName === 'render_diagram');
}

/** 失败原因不可被折叠掉:终态卡片必须保留错误步骤(review-w1 CONFIRMED)。 */
function isErrorStep(s: AgentStep): boolean {
  return s.error != null || s.kind === 'tool_error';
}

export function AgentStepList({ steps, run, resumeRun, onRefresh, expanded }: Props) {
  const navigation = useNavigation<any>();
  if (!steps.length) return null;

  const runId = run?.id ?? steps[0].runId;
  const terminal = !!run && isTerminalRunStatus(run.status);
  const goDetail = () => navigateBrainTab(navigation, 'BrainAgentTaskDetail', { runId });

  // W1c:去内嵌 ScrollView(嵌套滚动冲突 + maxHeight 截断)。
  //  - expanded(详情屏):全量平铺;
  //  - 聊天卡 · 运行中:最近 N 步 + 「查看全部」;
  //  - 聊天卡 · 终态:富内容步骤 + 「共 N 步」摘要链。
  let visible: AgentStep[];
  if (expanded) {
    visible = steps;
  } else if (terminal) {
    visible = steps.filter((s) => isRichStep(s) || isErrorStep(s));
  } else {
    visible = steps.slice(-VISIBLE_ACTIVE_STEPS);
  }

  // ask_user 兜底:等待输入时 ask 步若不在窗口内,单独补渲染其提问。
  const askStep =
    run?.status === 'awaiting_user_input' && resumeRun
      ? [...steps].reverse().find((s) => s.toolName === 'ask_user' && s.kind === 'tool_call')
      : undefined;
  const askOutsideWindow = askStep && !visible.includes(askStep) ? askStep : undefined;

  const hiddenCount = steps.length - visible.length;

  const renderAsk = (s: AgentStep) =>
    s.toolName === 'ask_user' &&
    s.kind === 'tool_call' &&
    run?.status === 'awaiting_user_input' &&
    resumeRun ? (
      <AskUserPrompt
        runId={s.runId}
        question={
          // run.pendingUserPrompt 是服务端权威来源；fallback 到 step.input.question 兼容老数据。
          run?.pendingUserPrompt ?? (s.input as { question?: string } | null)?.question ?? '请回答：'
        }
        options={(s.input as { options?: string[] } | null)?.options}
        resumeRun={resumeRun}
        onResumed={onRefresh}
      />
    ) : null;

  return (
    <View>
      {!expanded && !terminal && hiddenCount > 0 ? (
        <TouchableOpacity onPress={goDetail}>
          <Text style={{ fontSize: 12, color: colors.link, paddingVertical: 2 }}>
            已进行 {steps.length} 步 · 查看全部 →
          </Text>
        </TouchableOpacity>
      ) : null}
      {visible.map((s) => (
        <View key={s.id} style={{ paddingVertical: 2 }}>
          {expanded || !terminal || isErrorStep(s) ? (
            <Text style={{ fontSize: 12, opacity: 0.6 }}>
              #{s.idx} {KIND_LABEL[s.kind] ?? s.kind}
              {s.toolName ? ` · ${s.toolName}` : ''}
            </Text>
          ) : null}
          {s.error ? (
            <Text style={{ fontSize: 11, color: colors.danger, marginTop: 2 }}>{s.error}</Text>
          ) : null}
          {s.toolName === 'render_diagram' && s.kind === 'tool_call' ? (
            <DiagramStepCard step={s} />
          ) : null}
          {renderAsk(s)}
          {s.toolName === 'deep_research' && s.kind === 'tool_call' ? (
            (() => {
              // tool results are wrapped: s.output = { result: toolHandlerOutput, retried: boolean }
              const raw = s.output as {
                result?: {
                  ok?: boolean;
                  report?: string;
                  citations?: Array<{ kind: string; id: string; label?: string }>;
                  stepsUsed?: number;
                  childRunId?: string;
                };
              } | null;
              const out = raw?.result ?? null;
              const inp = s.input as { question?: string } | null;
              if (!out?.ok) return null;
              return (
                <>
                  <DeepResearchReport
                    question={inp?.question ?? '子任务'}
                    report={out.report ?? ''}
                    citations={out.citations}
                    stepsUsed={out.stepsUsed ?? 0}
                  />
                  {/* M7 T9：群聊子卡片 → 跳到子 run 详情 */}
                  {out.childRunId ? (
                    <TouchableOpacity
                      onPress={() =>
                        navigateBrainTab(navigation, 'BrainAgentTaskDetail', {
                          runId: out.childRunId!,
                        })
                      }
                    >
                      <Text style={{ color: colors.link, fontSize: 12, marginTop: 4 }}>
                        研究子任务（→ 查看详情）
                      </Text>
                    </TouchableOpacity>
                  ) : null}
                </>
              );
            })()
          ) : null}
        </View>
      ))}
      {askOutsideWindow ? <View style={{ paddingVertical: 2 }}>{renderAsk(askOutsideWindow)}</View> : null}
      {!expanded && terminal ? (
        <TouchableOpacity onPress={goDetail}>
          <Text style={{ fontSize: 12, color: colors.link, paddingVertical: 2 }}>
            共 {steps.length} 步 · 查看全部 →
          </Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}
