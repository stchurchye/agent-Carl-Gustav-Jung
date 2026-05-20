import type {
  IntentAnalyzeResult,
  IntentKind,
  MemoryIntentSlots,
} from '@xzz/shared';
import { api } from './api';
import { zh } from '../locales/zh-CN';

export type IntentChannel = 'private' | 'group';

export type IntentFlowContext = {
  channel: IntentChannel;
  aiMode: boolean;
  text: string;
  sessionId?: string;
  groupId?: string;
  topicId?: string;
  model?: string;
  contextSelection?: import('@xzz/shared').ContextSelection;
  selectedMessageIds?: string[];
};

export async function analyzeMessage(
  ctx: IntentFlowContext,
): Promise<IntentAnalyzeResult> {
  const res = await api.analyzeIntent({
    text: ctx.text,
    channel: ctx.channel,
    aiMode: ctx.aiMode,
    sessionId: ctx.sessionId,
    groupId: ctx.groupId,
    topicId: ctx.topicId,
  });
  return res.data;
}

export async function executeMessageIntent(
  ctx: IntentFlowContext & {
    kind: IntentKind;
    slots?: MemoryIntentSlots;
    targetFragmentId?: string;
  },
) {
  return api.executeIntent({
    text: ctx.text,
    kind: ctx.kind,
    slots: ctx.slots,
    targetFragmentId: ctx.targetFragmentId,
    channel: ctx.channel,
    sessionId: ctx.sessionId,
    groupId: ctx.groupId,
    topicId: ctx.topicId,
    model: ctx.model,
    contextSelection: ctx.contextSelection,
    selectedMessageIds: ctx.selectedMessageIds,
  });
}

export function shouldShowIntentChips(result: IntentAnalyzeResult): boolean {
  if (
    result.suggested === 'memory_correct' ||
    result.suggested === 'memory_forget' ||
    result.suggested === 'persona_open_settings' ||
    result.suggested === 'app_navigate' ||
    result.suggested === 'agent_run'
  ) {
    return true;
  }
  if (
    result.candidates.some(
      (c) => c.kind === 'app_navigate' || c.kind === 'agent_run',
    )
  ) {
    return true;
  }
  if (result.hint === 'no_memory_to_edit' || result.hint === 'extract_unavailable') {
    return true;
  }
  return !result.autoExecute;
}

export function intentHintMessage(
  hint: IntentAnalyzeResult['hint'],
): string | undefined {
  if (hint === 'no_memory_to_edit') return zh.intent.noMemoryToEdit;
  if (hint === 'extract_unavailable') return zh.intent.extractUnavailable;
  return undefined;
}
