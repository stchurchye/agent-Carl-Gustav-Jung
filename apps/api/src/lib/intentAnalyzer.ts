import type {
  IntentAnalyzeResult,
  IntentCandidate,
  IntentKind,
  MemoryIntentSlots,
} from '@xzz/shared';
import { isActionRequest, isExecutableIntentKind } from '@xzz/shared';
import { extractMemoryIntent } from './memoryExtract.js';
import {
  classifyIntent,
  classifiedToCandidates,
  hasCandidateScoreTie,
  mergeIntentCandidates,
} from './intentClassify.js';
import {
  buildCandidatesFromRules,
  needsSpecialIntentFromRules,
} from './intentRules.js';
import { listMemoryTargetsForUser } from './memoryResolve.js';

const T_HIGH = 0.82;
const T_GAP = 0.15;

export type IntentChannel = 'private' | 'group' | 'writing';

export type AnalyzeIntentInput = {
  text: string;
  channel: IntentChannel;
  aiMode: boolean;
  hasAttachments?: boolean;
  apiKey?: string;
  userId: string;
  sessionId?: string;
  groupId?: string;
  topicId?: string;
};

function defaultScope(input: AnalyzeIntentInput) {
  if (input.channel === 'private') return 'session' as const;
  if (input.channel === 'group') return 'topic' as const;
  return 'user' as const;
}

function defaultChatKind(input: AnalyzeIntentInput): IntentKind {
  return input.channel === 'group' ? 'chat_group_llm' : 'chat_private_llm';
}

function chatLabel(input: AnalyzeIntentInput): string {
  return input.channel === 'group' ? '请 AI 回复' : '和 Bow Wow 聊聊';
}

/** @internal exported for tests (M1e Task 13.5). */
export function pickAutoExecute(
  candidates: IntentCandidate[],
  forceChips: boolean,
): boolean {
  if (forceChips) return false;
  const top = candidates[0];
  const second = candidates[1];
  if (!top) return false;
  if (
    top.kind === 'memory_correct' ||
    top.kind === 'memory_forget' ||
    top.kind === 'app_navigate' ||
    top.kind === 'persona_open_settings' ||
    // M1e Task 13.5：把"agent_run 不 autoExecute"从废弃的 orchestrator.analyzeIntent
    // 移到生产 hot path 这里。agent run 启动有真金白银的 LLM 调用，必须明确意图
    // confirm。即使 confidence=1.0 也不 auto-execute；UI 仍然能用 chips 推荐。
    top.kind === 'agent_run'
  ) {
    return false;
  }
  if (top.confidence < T_HIGH) return false;
  if (second && top.confidence - second.confidence < T_GAP) return false;
  return true;
}

function filterExecutable(candidates: IntentCandidate[]): IntentCandidate[] {
  return candidates.filter((c) => isExecutableIntentKind(c.kind));
}

function fastChatResult(input: AnalyzeIntentInput): IntentAnalyzeResult {
  const chatKind = defaultChatKind(input);
  return {
    candidates: [
      {
        kind: chatKind,
        label: chatLabel(input),
        confidence: 0.99,
      },
    ],
    suggested: chatKind,
    autoExecute: true,
  };
}

async function maybeMergeClassify(
  input: AnalyzeIntentInput,
  candidates: IntentCandidate[],
  forceChips: boolean,
): Promise<{ candidates: IntentCandidate[]; forceChips: boolean }> {
  if (!input.apiKey) return { candidates, forceChips };

  const classified = await classifyIntent(
    input.apiKey,
    input.text,
    input.channel,
    {
      userId: input.userId,
      channel: 'intent_classify',
      sessionId: input.sessionId,
      groupId: input.groupId,
      topicId: input.topicId,
    },
  );

  const actionable = classified.filter((c) => c.kind !== 'chat');
  if (actionable.length === 0) return { candidates, forceChips };

  const merged = mergeIntentCandidates(
    candidates,
    classifiedToCandidates(actionable, input.channel),
  ).slice(0, 6);

  return {
    candidates: merged,
    forceChips: forceChips || actionable.length > 0,
  };
}

async function finalizeSpecialIntent(
  input: AnalyzeIntentInput,
  candidates: IntentCandidate[],
  forceChips: boolean,
): Promise<IntentAnalyzeResult> {
  const chatKind = defaultChatKind(input);
  let slots: MemoryIntentSlots | undefined;
  let hint: IntentAnalyzeResult['hint'];

  const topKind = candidates[0]?.kind;
  const needsMemoryExtract =
    topKind === 'memory_remember' ||
    topKind === 'memory_correct' ||
    topKind === 'memory_forget';

  if (needsMemoryExtract) {
    if (!input.apiKey) {
      hint = 'extract_unavailable';
    } else {
      const extract = await extractMemoryIntent(
        input.apiKey,
        input.text,
        defaultScope(input),
        {
          userId: input.userId,
          channel: 'memory_extract',
          sessionId: input.sessionId,
          groupId: input.groupId,
          topicId: input.topicId,
        },
      );
      if (extract.kind !== 'none' && extract.content) {
        slots = {
          scope: extract.scope,
          content: extract.content,
          explicitGlobal: extract.explicitGlobal,
          category: extract.category,
        };
        const memKind =
          extract.kind === 'remember'
            ? 'memory_remember'
            : extract.kind === 'correct'
              ? 'memory_correct'
              : 'memory_forget';
        candidates = candidates.filter((c) => !c.kind.startsWith('memory_'));
        candidates.unshift({
          kind: memKind,
          label:
            memKind === 'memory_remember'
              ? '记住'
              : memKind === 'memory_correct'
                ? '修正记忆'
                : '不再提起',
          confidence: 0.92,
          slots,
        });
        candidates.sort((a, b) => b.confidence - a.confidence);
        candidates = filterExecutable(candidates).slice(0, 6);
      } else if (extract.kind !== 'none' && !extract.content) {
        hint = 'extract_unavailable';
      }
    }
  }

  let suggested = candidates[0]?.kind ?? chatKind;

  if (suggested === 'memory_correct' || suggested === 'memory_forget') {
    const memoryTargets = await listMemoryTargetsForUser({
      userId: input.userId,
      sessionId: input.sessionId,
      groupId: input.groupId,
      topicId: input.topicId,
    });

    if (memoryTargets.length === 0) {
      hint = 'no_memory_to_edit';
      suggested = chatKind;
      candidates = filterExecutable([
        {
          kind: chatKind,
          label: chatLabel(input),
          confidence: 0.95,
        },
        {
          kind: 'memory_remember',
          label: '改为：记住新内容',
          confidence: 0.7,
        },
      ]);
      return {
        candidates,
        suggested,
        autoExecute: false,
        slots: undefined,
        memoryTargets: [],
        hint,
      };
    }

    return {
      candidates: filterExecutable(candidates),
      suggested,
      autoExecute: false,
      slots,
      memoryTargets,
      hint,
    };
  }

  if (
    needsMemoryExtract &&
    hint === 'extract_unavailable' &&
    (suggested === 'memory_remember' || !slots?.content)
  ) {
    candidates = filterExecutable([
      {
        kind: chatKind,
        label: '当普通聊天',
        confidence: 0.85,
      },
      ...candidates.filter((c) => c.kind.startsWith('memory_')),
    ]).slice(0, 6);
    suggested = candidates[0]?.kind ?? chatKind;
    return {
      candidates,
      suggested,
      autoExecute: false,
      slots,
      hint,
    };
  }

  candidates = filterExecutable(candidates).slice(0, 6);

  // persona_rename 等规则意图把 slots 挂在 candidate 上而非局部变量,这里补提升。
  const resolvedSlots = slots ?? candidates[0]?.slots;

  return {
    candidates,
    suggested,
    autoExecute: pickAutoExecute(candidates, forceChips),
    slots: resolvedSlots,
    hint,
  };
}

export async function analyzeIntentUnified(
  input: AnalyzeIntentInput,
): Promise<IntentAnalyzeResult> {
  if (!input.aiMode && input.channel === 'group') {
    return {
      candidates: [
        {
          kind: 'human_group_message',
          label: '发送群消息',
          confidence: 1,
        },
      ],
      suggested: 'human_group_message',
      autoExecute: true,
    };
  }

  const ruleCtx = {
    text: input.text,
    channel: input.channel,
    hasAttachments: input.hasAttachments,
  };

  const rulesHit = needsSpecialIntentFromRules(ruleCtx);

  if (!rulesHit) {
    if (!isActionRequest(input.text)) {
      return fastChatResult(input);
    }
    if (!input.apiKey) {
      return fastChatResult(input);
    }
    const classified = await classifyIntent(
      input.apiKey,
      input.text,
      input.channel,
      {
        userId: input.userId,
        channel: 'intent_classify',
        sessionId: input.sessionId,
        groupId: input.groupId,
        topicId: input.topicId,
      },
    );
    const actionable = classified.filter((c) => c.kind !== 'chat');
    if (actionable.length === 0) {
      return fastChatResult(input);
    }
    let candidates = classifiedToCandidates(actionable, input.channel);
    const ck = defaultChatKind(input);
    candidates = mergeIntentCandidates(candidates, [
      {
        kind: ck,
        label: chatLabel(input),
        confidence: 0.55,
        group: 'other',
      },
    ]).slice(0, 6);
    return finalizeSpecialIntent(input, candidates, true);
  }

  let { candidates, forceChips } = buildCandidatesFromRules(ruleCtx);

  const needsClassify =
    input.apiKey &&
    (hasCandidateScoreTie(candidates) || candidates[0]?.confidence < T_HIGH);

  if (needsClassify) {
    const merged = await maybeMergeClassify(input, candidates, forceChips);
    candidates = merged.candidates;
    forceChips = merged.forceChips;
  }

  return finalizeSpecialIntent(input, candidates, forceChips);
}
