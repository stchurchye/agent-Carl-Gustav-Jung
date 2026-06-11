import type {
  AppNavigateTarget,
  IntentCandidate,
  IntentKind,
  LlmRequestLogContext,
} from '@xzz/shared';
import { DEFAULT_TASK_PROFILES } from '@xzz/shared';
import type { IntentChannel } from './intentAnalyzer.js';
import { chatCompletionRaw, type ChatMessageInput } from './deepseek.js';

export type ClassifyIntentKind =
  | 'memory_remember'
  | 'memory_correct'
  | 'memory_forget'
  | 'context_compact'
  | 'persona_style'
  | 'persona_nav'
  | 'planning'
  | 'app_navigate'
  | 'chat';

export type ClassifiedIntent = {
  kind: ClassifyIntentKind;
  confidence: number;
  navigateTarget?: AppNavigateTarget;
  label?: string;
};

const NAV_LABELS: Record<AppNavigateTarget, string> = {
  personality: '打开性格设置',
  personality_identity: '改助手形象',
  personality_soul: '改交流风格',
  personality_user: '编辑关于我',
  memory_long: '查看长期记忆',
  memory_short: '查看短记忆',
  memory_session: '查看会话记忆',
  memory_topic: '查看话题记忆',
  api_keys: '狗狗的联络方式',
  voice: '朗读声音设置',
  export: '导出聊天记录',
  documents: '打开文稿列表',
  profile: '个人资料',
  llm_logs: '狗狗通讯记录',
  client_logs: '客户端日志',
  studio_settings: '打开设置',
};

function chatKind(channel: IntentChannel): IntentKind {
  return channel === 'group' ? 'chat_group_llm' : 'chat_private_llm';
}

function chatLabel(channel: IntentChannel): string {
  return channel === 'group' ? '请 AI 回复' : '和 Bow wow 聊聊';
}

export async function classifyIntent(
  apiKey: string,
  text: string,
  channel: IntentChannel,
  log?: LlmRequestLogContext,
): Promise<ClassifiedIntent[]> {
  const profile = DEFAULT_TASK_PROFILES.intent_classify;
  const system = `你是意图分类器。根据用户一句话输出 JSON（单独一行，无代码块）：
{"intents":[{"kind":"...","confidence":0.0-1.0,"navigateTarget":"可选","label":"可选中文短标签"}]}
kind 只能是：
memory_remember|memory_correct|memory_forget|context_compact|persona_style|persona_nav|planning|app_navigate|chat
规则：
- 只分类操作/设置类意图，普通闲聊 → chat confidence≥0.9
- 不要改写用户原文，不要 paraphrase
- navigateTarget 仅 kind=app_navigate 时填写：personality|personality_identity|personality_soul|personality_user|memory_long|memory_short|memory_session|memory_topic|api_keys|voice|export|documents|profile|llm_logs|client_logs|studio_settings
- persona_style=想改说话风格/语气；persona_nav=打开性格相关页面
- 可同时输出多个候选，confidence 反映把握度
- 频道：${channel}`;

  const raw = await chatCompletionRaw(
    apiKey,
    [
      { role: 'system', content: system },
      { role: 'user', content: text },
    ] as ChatMessageInput[],
    {
      maxTokens: profile.maxTokens,
      temperature: profile.temperature,
      log: log ? { ...log, channel: 'intent_classify' } : undefined,
    },
  );

  const line = raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .pop();

  try {
    const parsed = JSON.parse(line ?? '{}') as {
      intents?: Array<{
        kind?: string;
        confidence?: number;
        navigateTarget?: AppNavigateTarget;
        label?: string;
      }>;
    };
    const allowed = new Set<string>([
      'memory_remember',
      'memory_correct',
      'memory_forget',
      'context_compact',
      'persona_style',
      'persona_nav',
      'planning',
      'app_navigate',
      'chat',
    ]);
    return (parsed.intents ?? [])
      .filter((i) => i.kind && allowed.has(i.kind))
      .map((i) => ({
        kind: i.kind as ClassifyIntentKind,
        confidence: Math.min(1, Math.max(0, Number(i.confidence) || 0)),
        navigateTarget: i.navigateTarget,
        label: i.label?.trim() || undefined,
      }))
      .filter((i) => i.confidence > 0.35)
      .slice(0, 6);
  } catch (e) {
    // LLM 没按格式回 JSON:照旧优雅降级(调用方 fallback 到普通聊天),
    // 但留日志 —— 否则格式回归毫无信号,排查无门(review P2)。
    console.warn(
      `[classifyIntent] LLM 输出无法解析为 JSON,降级为空候选: ${String(line).slice(0, 120)}`,
      e,
    );
    return [];
  }
}

export function classifiedToCandidates(
  classified: ClassifiedIntent[],
  channel: IntentChannel,
): IntentCandidate[] {
  const ck = chatKind(channel);
  const out: IntentCandidate[] = [];

  for (const item of classified) {
    if (item.kind === 'chat') {
      out.push({
        kind: ck,
        label: item.label ?? chatLabel(channel),
        confidence: item.confidence,
        group: 'other',
      });
      continue;
    }
    if (item.kind === 'memory_remember') {
      out.push({
        kind: 'memory_remember',
        label: item.label ?? '记住',
        confidence: item.confidence,
        group: 'primary',
      });
      continue;
    }
    if (item.kind === 'memory_correct') {
      out.push({
        kind: 'memory_correct',
        label: item.label ?? '修正记忆',
        confidence: item.confidence,
        group: 'primary',
      });
      continue;
    }
    if (item.kind === 'memory_forget') {
      out.push({
        kind: 'memory_forget',
        label: item.label ?? '不再提起',
        confidence: item.confidence,
        group: 'primary',
      });
      continue;
    }
    if (item.kind === 'context_compact') {
      out.push({
        kind: 'context_compact',
        label: item.label ?? '压缩上下文',
        confidence: item.confidence,
        group: 'primary',
      });
      continue;
    }
    if (item.kind === 'persona_style' || item.kind === 'persona_nav') {
      out.push({
        kind: 'app_navigate',
        label: item.label ?? '打开性格设置',
        confidence: item.confidence,
        group: 'primary',
        slots: { navigateTarget: 'personality' },
      });
      out.push({
        kind: ck,
        label: chatLabel(channel),
        description: '在对话里说明你想怎么改',
        confidence: Math.max(0.45, item.confidence - 0.25),
        group: 'other',
      });
      continue;
    }
    if (item.kind === 'planning') {
      out.push(
        {
          kind: ck,
          label: '只讨论、不写入待办',
          confidence: item.confidence,
          group: 'primary',
        },
        {
          kind: ck,
          label: '整理成待办清单',
          confidence: Math.max(0.5, item.confidence - 0.06),
          group: 'primary',
        },
        {
          kind: 'memory_remember',
          label: '记住为偏好',
          confidence: Math.max(0.45, item.confidence - 0.12),
          group: 'other',
        },
      );
      continue;
    }
    if (item.kind === 'app_navigate' && item.navigateTarget) {
      const target = item.navigateTarget;
      out.push({
        kind: 'app_navigate',
        label: item.label ?? NAV_LABELS[target] ?? '打开页面',
        confidence: item.confidence,
        group: 'primary',
        slots: { navigateTarget: target },
      });
    }
  }

  return out;
}

export function mergeIntentCandidates(
  base: IntentCandidate[],
  extra: IntentCandidate[],
): IntentCandidate[] {
  const map = new Map<string, IntentCandidate>();
  const key = (c: IntentCandidate) =>
    `${c.kind}:${c.label}:${c.slots?.navigateTarget ?? ''}`;

  for (const c of [...base, ...extra]) {
    const k = key(c);
    const prev = map.get(k);
    if (!prev || c.confidence > prev.confidence) {
      map.set(k, c);
    }
  }
  return [...map.values()].sort((a, b) => b.confidence - a.confidence);
}

export const CLASSIFY_TIE_GAP = 0.15;

export function hasCandidateScoreTie(candidates: IntentCandidate[]): boolean {
  const top = candidates[0];
  const second = candidates[1];
  if (!top || !second) return false;
  return top.confidence - second.confidence < CLASSIFY_TIE_GAP;
}
