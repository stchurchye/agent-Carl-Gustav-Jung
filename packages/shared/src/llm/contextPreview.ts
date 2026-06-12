import { SUMMARY_PREFIX, estimateTokens } from './contextBudget.js';
import type { AssembleChatResult, AssembleWritingIntentResult, ContextChatMessage } from './contextBudget.js';
import type { ContextUsage } from './contextBudget.js';
import type { LlmExcludeMeta } from './llmExclude.js';

export type ContextBlockKind =
  | 'system'
  | 'summary'
  | 'history_user'
  | 'history_assistant'
  | 'group_history'
  | 'document_chapter'
  | 'document_excerpt'
  | 'pending_user'
  | 'instruction';

export type ContextPreviewBlock = {
  id: string;
  kind: ContextBlockKind;
  label: string;
  content: string;
  tokens: number;
  selectable: boolean;
  selectedByDefault: boolean;
  messageId?: string;
  role?: 'user' | 'assistant';
  omittedByBudget?: boolean;
  llmExclude?: LlmExcludeMeta;
};

export type ContextPreview = {
  blocks: ContextPreviewBlock[];
  usage: ContextUsage;
  messages: ContextChatMessage[];
};

export type ContextSelection = {
  /** 写作：未勾选的 document_chapter / document_excerpt 等 block id */
  excludedBlockIds?: string[];
  /** 历史消息：用户明确取消勾选的消息 id */
  excludedMessageIds?: string[];
  /** @deprecated 仅兼容旧客户端；有 excludedMessageIds 时忽略 */
  selectedMessageIds?: string[];
  /** @deprecated 应用后请用 excluded* */
  selectedBlockIds?: string[];
};

export function usesExclusionMode(selection?: ContextSelection | null): boolean {
  if (!selection) return false;
  return (
    selection.excludedMessageIds !== undefined || selection.excludedBlockIds !== undefined
  );
}

export type GroupMessageForPreview = {
  id: string;
  kind: string;
  content: string;
  authorDisplayName?: string | null;
  invokerAssistantName?: string | null;
};

function blockId(prefix: string, index: number): string {
  return `${prefix}-${index}`;
}

export function formatMessagesAsMarkdown(messages: ContextChatMessage[]): string {
  return messages
    .map((m) => {
      const role =
        m.role === 'system' ? 'system' : m.role === 'assistant' ? 'assistant' : 'user';
      return `### ${role}\n\n${m.content}`;
    })
    .join('\n\n---\n\n');
}

/** @deprecated 白名单；请用 exclusionFromBlocks */
export function selectionFromBlocks(
  blocks: ContextPreviewBlock[],
  selectedBlockIds: string[],
): ContextSelection {
  const selected = new Set(selectedBlockIds);
  const messageIds = blocks
    .filter((b) => selected.has(b.id) && b.messageId)
    .map((b) => b.messageId!);
  return { selectedBlockIds: [...selected], selectedMessageIds: messageIds };
}

/** 由组装器勾选状态生成排除名单（未勾选的块/消息） */
export function exclusionFromBlocks(
  blocks: ContextPreviewBlock[],
  selectedBlockIds: string[],
): ContextSelection {
  const selected = new Set(selectedBlockIds);
  const excludedMessageIds: string[] = [];
  const excludedBlockIds: string[] = [];
  for (const b of blocks) {
    if (!b.selectable || b.omittedByBudget) continue;
    if (selected.has(b.id)) continue;
    if (b.messageId) excludedMessageIds.push(b.messageId);
    else excludedBlockIds.push(b.id);
  }
  return { excludedMessageIds, excludedBlockIds };
}

/** 从排除名单恢复组装器勾选 block id */
export function selectedBlockIdsFromExclusion(
  blocks: ContextPreviewBlock[],
  selection: ContextSelection,
): string[] {
  if (usesExclusionMode(selection)) {
    const excludedMsg = new Set(selection.excludedMessageIds ?? []);
    const excludedBlock = new Set(selection.excludedBlockIds ?? []);
    const ids: string[] = [];
    for (const b of blocks) {
      if (!b.selectable) {
        ids.push(b.id);
        continue;
      }
      if (b.omittedByBudget) continue;
      if (b.messageId && excludedMsg.has(b.messageId)) continue;
      if (excludedBlock.has(b.id)) continue;
      ids.push(b.id);
    }
    return ids;
  }
  if (selection.selectedBlockIds?.length) {
    return selection.selectedBlockIds;
  }
  return defaultSelectedBlockIds(blocks);
}

export function resolveIncludedMessages<T extends { id: string }>(
  all: T[],
  selection?: ContextSelection | null,
  defaultWhenEmpty?: T[],
): T[] {
  if (!selection) return defaultWhenEmpty ?? all;
  if (usesExclusionMode(selection)) {
    const excluded = new Set(selection.excludedMessageIds ?? []);
    return all.filter((m) => !excluded.has(m.id));
  }
  if (selection.selectedMessageIds?.length) {
    const ids = new Set(selection.selectedMessageIds);
    return all.filter((m) => ids.has(m.id));
  }
  return defaultWhenEmpty ?? all;
}

export function defaultSelectedBlockIds(blocks: ContextPreviewBlock[]): string[] {
  return blocks.filter((b) => b.selectedByDefault && !b.omittedByBudget).map((b) => b.id);
}

export function applyBlockSelectionToMessages(
  preview: ContextPreview,
  selectedBlockIds: string[],
): ContextChatMessage[] {
  const selected = new Set(selectedBlockIds);
  const out: ContextChatMessage[] = [];
  for (const block of preview.blocks) {
    if (!selected.has(block.id)) continue;
    if (block.kind === 'system') {
      out.push({ role: 'system', content: block.content });
    } else if (block.kind === 'summary') {
      out.push({ role: 'user', content: block.content });
    } else if (block.kind === 'history_user') {
      out.push({ role: 'user', content: block.content });
    } else if (block.kind === 'history_assistant') {
      out.push({ role: 'assistant', content: block.content });
    } else if (block.kind === 'group_history') {
      // group uses combined user message in invoke — handled separately
    } else if (block.kind === 'pending_user' || block.kind === 'instruction') {
      out.push({ role: 'user', content: block.content });
    } else if (block.kind === 'document_chapter' || block.kind === 'document_excerpt') {
      // writing: merged into final user turn by caller
    }
  }
  return out;
}

export function blocksFromAssembleChatResult(
  assembled: AssembleChatResult,
  opts?: {
    historyMessageIds?: string[];
    excludedMessageIds?: string[];
    messageLlmExclude?: Record<string, LlmExcludeMeta | undefined>;
  },
): ContextPreview {
  const excludedMsg = new Set(opts?.excludedMessageIds ?? []);
  const useExclusion = opts?.excludedMessageIds !== undefined;
  const blocks: ContextPreviewBlock[] = [];
  let idx = 0;

  const systemMsg = assembled.messages.find((m) => m.role === 'system');
  if (systemMsg) {
    blocks.push({
      id: blockId('system', idx++),
      kind: 'system',
      label: '系统提示词',
      content: systemMsg.content,
      tokens: estimateTokens(systemMsg.content),
      selectable: false,
      selectedByDefault: true,
    });
  }

  const summaryMsg = assembled.messages.find(
    (m) => m.role === 'user' && m.content.startsWith(SUMMARY_PREFIX),
  );
  if (summaryMsg) {
    blocks.push({
      id: blockId('summary', idx++),
      kind: 'summary',
      label: '对话摘要',
      content: summaryMsg.content,
      tokens: estimateTokens(summaryMsg.content),
      selectable: true,
      selectedByDefault: true,
    });
  }

  let historyIdx = 0;
  for (const msg of assembled.messages) {
    if (msg.role === 'system') continue;
    if (msg.role === 'user' && msg.content.startsWith(SUMMARY_PREFIX)) continue;
    if (msg === assembled.messages[assembled.messages.length - 1]) continue;

    const messageId = opts?.historyMessageIds?.[historyIdx];
    const llmEx = messageId ? opts?.messageLlmExclude?.[messageId] : undefined;
    const kind = msg.role === 'assistant' ? 'history_assistant' : 'history_user';
    let selectable = true;
    let selectedByDefault =
      useExclusion && messageId ? !excludedMsg.has(messageId) : true;
    if (llmEx?.active) {
      selectable = false;
      selectedByDefault = false;
    } else if (llmEx?.everCanceled && !llmEx.active) {
      selectedByDefault = true;
    }
    blocks.push({
      id: blockId('history', idx++),
      kind,
      label: msg.role === 'assistant' ? `助手 #${historyIdx + 1}` : `用户 #${historyIdx + 1}`,
      content: msg.content,
      tokens: estimateTokens(msg.content),
      selectable,
      selectedByDefault,
      messageId,
      role: msg.role,
      llmExclude: llmEx,
    });
    historyIdx += 1;
  }

  for (let oi = 0; oi < assembled.messagesToCompact.length; oi++) {
    const turn = assembled.messagesToCompact[oi]!;
    const kind = turn.role === 'assistant' ? 'history_assistant' : 'history_user';
    blocks.push({
      id: blockId('omitted', idx++),
      kind,
      label: turn.role === 'assistant' ? `助手（已裁切）` : `用户（已裁切）`,
      content: turn.content,
      tokens: estimateTokens(turn.content),
      selectable: true,
      selectedByDefault: false,
      omittedByBudget: true,
      role: turn.role,
    });
  }

  const pending = assembled.messages[assembled.messages.length - 1];
  if (pending?.role === 'user') {
    blocks.push({
      id: blockId('pending', idx++),
      kind: 'pending_user',
      label: '待发送',
      content: pending.content,
      tokens: estimateTokens(pending.content),
      selectable: false,
      selectedByDefault: true,
    });
  }

  return {
    blocks,
    usage: assembled.usage,
    messages: assembled.messages,
  };
}

export function blocksFromGroupMessages(params: {
  messages: GroupMessageForPreview[];
  systemPrompt: string;
  instruction: string;
  /** 排除名单模式 */
  excludedMessageIds?: string[];
  /** @deprecated 白名单 */
  selectedMessageIds?: string[];
  messageLlmExclude?: Record<string, LlmExcludeMeta | undefined>;
}): ContextPreview {
  const { messages, systemPrompt, instruction } = params;
  const excludedSet = new Set(params.excludedMessageIds ?? []);
  const useExclusion = params.excludedMessageIds !== undefined;
  const selectedSet = new Set(params.selectedMessageIds ?? []);
  const useLegacyWhitelist = !useExclusion && (params.selectedMessageIds?.length ?? 0) > 0;

  const blocks: ContextPreviewBlock[] = [];
  let idx = 0;

  blocks.push({
    id: blockId('system', idx++),
    kind: 'system',
    label: '系统提示词',
    content: systemPrompt,
    tokens: estimateTokens(systemPrompt),
    selectable: false,
    selectedByDefault: true,
  });

  const defaultRecent = messages.slice(-12);
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]!;
    if (m.kind === 'system') continue;
    const who =
      m.kind === 'ai' && m.invokerAssistantName
        ? `${m.authorDisplayName ?? '成员'} 的 ${m.invokerAssistantName}`
        : m.authorDisplayName ?? '成员';
    const line = `${who}: ${m.content}`;
    const inDefault = defaultRecent.some((d) => d.id === m.id);
    const llmEx = params.messageLlmExclude?.[m.id];
    let selectable = true;
    let selectedByDefault = useExclusion
      ? !excludedSet.has(m.id)
      : useLegacyWhitelist
        ? selectedSet.has(m.id)
        : inDefault;
    if (llmEx?.active) {
      selectable = false;
      selectedByDefault = false;
    } else if (llmEx?.everCanceled && !llmEx.active) {
      selectedByDefault = true;
    }

    blocks.push({
      id: blockId('group', idx++),
      kind: 'group_history',
      label: who,
      content: line,
      tokens: estimateTokens(line),
      selectable,
      selectedByDefault,
      messageId: m.id,
      llmExclude: llmEx,
    });
  }

  const instructionContent = `【用户请你回复】\n${instruction}`;
  blocks.push({
    id: blockId('instruction', idx++),
    kind: 'instruction',
    label: '本次指令',
    content: instructionContent,
    tokens: estimateTokens(instructionContent),
    selectable: false,
    selectedByDefault: true,
  });

  const selectedMessages = useExclusion
    ? messages.filter((m) => m.kind !== 'system' && !excludedSet.has(m.id))
    : useLegacyWhitelist
      ? messages.filter((m) => selectedSet.has(m.id))
      : defaultRecent;
  const historyText = selectedMessages
    .filter((m) => m.kind !== 'system')
    .map((m) => {
      const who =
        m.kind === 'ai' && m.invokerAssistantName
          ? `${m.authorDisplayName ?? '成员'} 的 ${m.invokerAssistantName}`
          : m.authorDisplayName ?? '成员';
      return `${who}: ${m.content}`;
    })
    .join('\n');

  const userContent = `【群聊记录】\n${historyText}\n\n${instructionContent}`;
  const llmMessages: ContextChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userContent },
  ];

  const usedTokens =
    estimateTokens(systemPrompt) + estimateTokens(userContent) + 2048;
  const limitTokens = 128_000;

  return {
    blocks,
    usage: {
      usedTokens,
      limitTokens,
      ratio: Math.min(1, usedTokens / limitTokens),
      breakdown: {
        system: estimateTokens(systemPrompt),
        summary: 0,
        history: estimateTokens(historyText),
        document: 0,
        pendingUser: estimateTokens(instructionContent),
        outputReserve: 2048,
      },
      compacted: false,
      droppedVerbatimTurns: 0,
    },
    messages: llmMessages,
  };
}

export function blocksFromWritingIntent(
  assembled: AssembleWritingIntentResult,
  opts: {
    chapterBlock: string;
    documentBlock: string;
    historyMessageIds?: string[];
    excludedMessageIds?: string[];
    excludedBlockIds?: string[];
    messageLlmExclude?: Record<string, LlmExcludeMeta | undefined>;
  },
): ContextPreview {
  const excludedMsg = new Set(opts.excludedMessageIds ?? []);
  const excludedBlock = new Set(opts.excludedBlockIds ?? []);
  const useMsgExclusion = opts.excludedMessageIds !== undefined;
  const useBlockExclusion = opts.excludedBlockIds !== undefined;
  const blocks: ContextPreviewBlock[] = [];
  let idx = 0;

  const systemMsg = assembled.messages.find((m) => m.role === 'system');
  if (systemMsg) {
    blocks.push({
      id: blockId('system', idx++),
      kind: 'system',
      label: '系统提示词',
      content: systemMsg.content,
      tokens: estimateTokens(systemMsg.content),
      selectable: false,
      selectedByDefault: true,
    });
  }

  const summaryMsg = assembled.messages.find(
    (m) => m.role === 'user' && m.content.startsWith(SUMMARY_PREFIX),
  );
  if (summaryMsg) {
    blocks.push({
      id: blockId('summary', idx++),
      kind: 'summary',
      label: '写作对话摘要',
      content: summaryMsg.content,
      tokens: estimateTokens(summaryMsg.content),
      selectable: true,
      selectedByDefault: true,
    });
  }

  if (opts.chapterBlock.trim()) {
    const chapterId = blockId('chapter', idx++);
    blocks.push({
      id: chapterId,
      kind: 'document_chapter',
      label: '当前段落',
      content: opts.chapterBlock,
      tokens: estimateTokens(opts.chapterBlock),
      selectable: true,
      selectedByDefault: useBlockExclusion ? !excludedBlock.has(chapterId) : true,
    });
  }

  if (opts.documentBlock.trim()) {
    const documentId = blockId('document', idx++);
    blocks.push({
      id: documentId,
      kind: 'document_excerpt',
      label: '全篇节选',
      content: opts.documentBlock,
      tokens: estimateTokens(opts.documentBlock),
      selectable: true,
      selectedByDefault: useBlockExclusion ? !excludedBlock.has(documentId) : true,
    });
  }

  let historyIdx = 0;
  for (const msg of assembled.messages) {
    if (msg.role === 'system') continue;
    if (msg.role === 'user' && msg.content.startsWith(SUMMARY_PREFIX)) continue;
    if (msg === assembled.messages[assembled.messages.length - 1]) continue;

    const kind = msg.role === 'assistant' ? 'history_assistant' : 'history_user';
    const messageId = opts.historyMessageIds?.[historyIdx];
    const llmEx = messageId ? opts.messageLlmExclude?.[messageId] : undefined;
    let selectable = true;
    let selectedByDefault =
      useMsgExclusion && messageId ? !excludedMsg.has(messageId) : true;
    if (llmEx?.active) {
      selectable = false;
      selectedByDefault = false;
    } else if (llmEx?.everCanceled && !llmEx.active) {
      selectedByDefault = true;
    }
    blocks.push({
      id: blockId('whist', idx++),
      kind,
      label: msg.role === 'assistant' ? `Bow Wow #${historyIdx + 1}` : `用户 #${historyIdx + 1}`,
      content: msg.content,
      tokens: estimateTokens(msg.content),
      selectable,
      selectedByDefault,
      messageId,
      role: msg.role,
      llmExclude: llmEx,
    });
    historyIdx += 1;
  }

  for (const turn of assembled.messagesToCompact) {
    const kind = turn.role === 'assistant' ? 'history_assistant' : 'history_user';
    blocks.push({
      id: blockId('womit', idx++),
      kind,
      label: turn.role === 'assistant' ? 'Bow Wow（已裁切）' : '用户（已裁切）',
      content: turn.content,
      tokens: estimateTokens(turn.content),
      selectable: true,
      selectedByDefault: false,
      omittedByBudget: true,
      role: turn.role,
    });
  }

  const pending = assembled.messages[assembled.messages.length - 1];
  if (pending?.role === 'user') {
    blocks.push({
      id: blockId('wpending', idx++),
      kind: 'pending_user',
      label: '待发送',
      content: pending.content,
      tokens: estimateTokens(pending.content),
      selectable: false,
      selectedByDefault: true,
    });
  }

  return {
    blocks,
    usage: assembled.usage,
    messages: assembled.messages,
  };
}

export function filterHistoryTurns<T extends { role: string; content: string; id?: string }>(
  history: T[],
  selection?: ContextSelection | null,
): T[] {
  if (!selection) return history;
  if (usesExclusionMode(selection)) {
    const excluded = new Set(selection.excludedMessageIds ?? []);
    return history.filter((h) => (h.id ? !excluded.has(h.id) : true));
  }
  if (selection.selectedMessageIds?.length) {
    const ids = new Set(selection.selectedMessageIds);
    return history.filter((h) => (h.id ? ids.has(h.id) : true));
  }
  return history;
}
