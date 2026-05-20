import type {
  ChatMessage,
  ChatSession,
  ContextPreview,
  ContextSelection,
  ContextUsage,
  Document,
  Group,
  GroupListItem,
  GroupMember,
  GroupMessage,
  LlmInvokeJob,
  Revision,
  Topic,
  User,
  UserAiProfile,
  UserPersonaSettings,
  UserProfileHistory,
  IntentAnalyzeResult,
  IntentExecuteResult,
  IntentKind,
  LlmRequestLogDetail,
  LlmRequestLogListItem,
  MemoryFragment,
  MemoryCategory,
  MemoryIntentSlots,
  MemorySessionSearchHit,
  UserMemorySettings,
  AuthTokens,
  WritingAssistantMessage,
} from '@xzz/shared';
import { API_BASE_URL } from './config';
import { ApiRequestError, fetchJsonWithRetry } from './apiRequest';
import { getDeepSeekApiKey } from './deepseekKey';
import { getZenMuxApiKey } from './zenmuxKey';
import { getDashScopeApiKey } from './dashscopeKey';
import { getStoredDialect } from './tts';
import { getAccessToken } from './authSession';
import { isAuthErrorMessage, notifyUnauthorized } from './authEvents';
import {
  CHAT_LLM_MODEL_HEADER,
  REPLY_DIALECT_HEADER,
  type WritingUnderstandingScope,
} from '@xzz/shared';
import { getChatLlmModel } from './chatLlmModel';

export { ApiRequestError };

function contextSelectionQuery(sel?: ContextSelection): string {
  if (!sel) return '';
  const q = new URLSearchParams();
  const exclusionMode =
    sel.excludedMessageIds !== undefined || sel.excludedBlockIds !== undefined;
  if (exclusionMode) {
    q.set('excludedIds', (sel.excludedMessageIds ?? []).join(','));
    q.set('excludedBlockIds', (sel.excludedBlockIds ?? []).join(','));
  } else {
    if (sel.selectedMessageIds?.length) {
      q.set('selectedIds', sel.selectedMessageIds.join(','));
    }
    if (sel.selectedBlockIds?.length) {
      q.set('selectedBlockIds', sel.selectedBlockIds.join(','));
    }
  }
  const s = q.toString();
  return s ? `&${s}` : '';
}

async function authHeaders(): Promise<Record<string, string>> {
  const [deepseek, zenmux, dashscope, dialect, token, chatModel] = await Promise.all([
    getDeepSeekApiKey(),
    getZenMuxApiKey(),
    getDashScopeApiKey(),
    getStoredDialect(),
    getAccessToken(),
    getChatLlmModel(),
  ]);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (deepseek) headers['X-DeepSeek-Api-Key'] = deepseek;
  if (zenmux) headers['X-ZenMux-Api-Key'] = zenmux;
  if (dashscope) headers['X-DashScope-Api-Key'] = dashscope;
  headers[REPLY_DIALECT_HEADER] = dialect;
  headers[CHAT_LLM_MODEL_HEADER] = chatModel;
  return headers;
}

function networkErrorMessage(): string {
  return `连不上小助手服务（${API_BASE_URL}）。请在本机终端运行：npm run dev:api`;
}

async function request<T>(
  path: string,
  options?: RequestInit,
): Promise<{ ok: true; data: T; requestId: string }> {
  const baseHeaders = await authHeaders();
  const url = `${API_BASE_URL}${path}`;

  try {
    return await fetchJsonWithRetry<T>(url, {
      ...options,
      headers: {
        ...baseHeaders,
        ...(options?.headers as Record<string, string>),
      },
    });
  } catch (e) {
    if (e instanceof ApiRequestError) {
      if (
        e.status === 401 ||
        e.code === 'AUTH_UNAUTHORIZED' ||
        isAuthErrorMessage(e.message)
      ) {
        notifyUnauthorized();
      }
      const err = new Error(e.message) as Error & { hint?: string; code?: string };
      err.hint = e.hint;
      err.code = e.code;
      throw err;
    }
    throw new Error(networkErrorMessage());
  }
}

export const api = {
  health: () => request<{ service: string }>('/health'),

  listDocuments: () => request<Document[]>('/api/documents'),

  createDocument: (title: string) =>
    request<Document>('/api/documents', {
      method: 'POST',
      body: JSON.stringify({ title }),
    }),

  getDocument: (id: string) => request<Document>(`/api/documents/${id}`),

  updateDocument: (id: string, patch: Partial<Document>) =>
    request<Document>(`/api/documents/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  addChapter: (documentId: string, title?: string) =>
    request<Document>(`/api/documents/${documentId}/chapters`, {
      method: 'POST',
      body: JSON.stringify(title ? { title } : {}),
    }),

  listRevisions: (documentId: string) =>
    request<Revision[]>(`/api/documents/${documentId}/revisions`),

  aiSuggest: (
    documentId: string,
    blockId: string,
    action: string,
    options?: {
      instruction?: string;
      retry?: {
        baseInstruction: string;
        previousSuggestion: string;
        additionalFeedback: string;
        priorFeedback?: string[];
      };
    },
  ) =>
    request<{
      revision: Revision;
      oldText: string;
      newText: string;
      comment: string;
    }>(`/api/documents/${documentId}/ai`, {
      method: 'POST',
      body: JSON.stringify({
        blockId,
        action,
        instruction: options?.instruction,
        retry: options?.retry,
      }),
    }),

  acceptRevision: (
    documentId: string,
    revisionId: string,
    editedSnapshot?: string,
  ) =>
    request<Document>(`/api/documents/${documentId}/revisions/${revisionId}/accept`, {
      method: 'POST',
      body: JSON.stringify(
        editedSnapshot != null ? { editedSnapshot } : {},
      ),
    }),

  rejectRevision: (documentId: string, revisionId: string) =>
    request<Revision>(`/api/documents/${documentId}/revisions/${revisionId}/reject`, {
      method: 'POST',
    }),

  rollback: (documentId: string, revisionId: string) =>
    request<Revision>(`/api/documents/${documentId}/rollback`, {
      method: 'POST',
      body: JSON.stringify({ revisionId }),
    }),

  getWritingAssistantMessages: (documentId: string) =>
    request<WritingAssistantMessage[]>(`/api/documents/${documentId}/assistant/messages`),

  markWritingLlmExclude: (documentId: string, messageId: string) =>
    request<WritingAssistantMessage>(
      `/api/documents/${documentId}/assistant/messages/${messageId}/llm-exclude`,
      { method: 'POST' },
    ),

  cancelWritingLlmExclude: (documentId: string, messageId: string) =>
    request<WritingAssistantMessage>(
      `/api/documents/${documentId}/assistant/messages/${messageId}/llm-exclude/cancel`,
      { method: 'POST' },
    ),

  sendWritingAssistantMessage: (
    documentId: string,
    payload: {
      content: string;
      articleExcerpt: string;
      chapterId: string;
      chapterTitle: string;
      chapterContent: string;
      documentExcerpt: string;
      contextSelection?: ContextSelection;
    },
  ) =>
    request<{
      user: WritingAssistantMessage;
      assistant: WritingAssistantMessage;
      contextUsage: ContextUsage;
    }>(`/api/documents/${documentId}/assistant/messages`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  confirmWritingAssistant: (
    documentId: string,
    body: {
      messageId: string;
      approved: boolean;
      blockId: string;
      articleExcerpt: string;
      chapterId: string;
      chapterTitle: string;
      chapterContent: string;
      documentExcerpt: string;
      understandingScope: WritingUnderstandingScope;
    },
  ) =>
    request<{
      assistant?: WritingAssistantMessage;
      revision?: Revision;
      oldText?: string;
      newText?: string;
      comment?: string;
      contextUsage?: ContextUsage;
    }>(`/api/documents/${documentId}/assistant/confirm`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  getWritingAssistantContextUsage: (
    documentId: string,
    params: {
      chapterTitle: string;
      chapterContent: string;
      documentExcerpt: string;
      pending?: string;
    },
  ) => {
    const q = new URLSearchParams({
      chapterTitle: params.chapterTitle,
      chapterContent: params.chapterContent,
      documentExcerpt: params.documentExcerpt,
    });
    if (params.pending?.trim()) q.set('pending', params.pending.trim());
    return request<ContextUsage>(
      `/api/documents/${documentId}/assistant/context-usage?${q.toString()}`,
    );
  },

  listChatSessions: () => request<ChatSession[]>('/api/chat/sessions'),

  createChatSession: (title?: string) =>
    request<ChatSession>('/api/chat/sessions', {
      method: 'POST',
      body: JSON.stringify({ title }),
    }),

  updateChatSession: (sessionId: string, title: string) =>
    request<ChatSession>(`/api/chat/sessions/${sessionId}`, {
      method: 'PATCH',
      body: JSON.stringify({ title }),
    }),

  getChatMessages: (sessionId: string) =>
    request<ChatMessage[]>(`/api/chat/sessions/${sessionId}/messages`),

  getChatContextUsage: (sessionId: string, pending?: string) => {
    const q = pending?.trim() ? `?pending=${encodeURIComponent(pending.trim())}` : '';
    return request<ContextUsage>(`/api/chat/sessions/${sessionId}/context-usage${q}`);
  },

  getChatContextPreview: (
    sessionId: string,
    params: { pending?: string; contextSelection?: ContextSelection },
  ) => {
    const q = new URLSearchParams();
    if (params.pending?.trim()) q.set('pending', params.pending.trim());
    const base = q.toString() ? `?${q}` : '?';
    return request<ContextPreview>(
      `/api/chat/sessions/${sessionId}/context-preview${base}${contextSelectionQuery(params.contextSelection)}`,
    );
  },

  markChatLlmExclude: (sessionId: string, messageId: string) =>
    request<ChatMessage>(`/api/chat/sessions/${sessionId}/messages/${messageId}/llm-exclude`, {
      method: 'POST',
    }),

  cancelChatLlmExclude: (sessionId: string, messageId: string) =>
    request<ChatMessage>(
      `/api/chat/sessions/${sessionId}/messages/${messageId}/llm-exclude/cancel`,
      { method: 'POST' },
    ),

  sendChatMessage: (
    sessionId: string,
    content: string,
    opts?: { model?: string; askAi?: boolean; contextSelection?: ContextSelection },
  ) =>
    request<{
      user: ChatMessage;
      assistant: ChatMessage;
      session?: ChatSession;
      contextUsage: ContextUsage;
    }>(`/api/chat/sessions/${sessionId}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        content,
        model: opts?.model,
        askAi: opts?.askAi === true,
        contextSelection: opts?.contextSelection,
      }),
    }),

  listChatModels: () =>
    request<{
      models: Array<{ id: string; label: string; provider: string }>;
      defaultModel: string;
    }>('/api/settings/chat-models'),

  getDeepSeekStatus: () =>
    request<{
      configured: boolean;
      source: string;
      model: string;
      displayName: string;
    }>('/api/settings/deepseek'),

  verifyDeepSeekKey: () =>
    request<{ valid: boolean; message: string }>('/api/settings/deepseek/verify', {
      method: 'POST',
    }),

  ocrImage: (body: { imageBase64: string; mimeType?: string; purpose?: string }) =>
    request<{ text: string }>('/api/ocr', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  transcribeAudio: (body: { audioBase64: string; format?: string }) =>
    request<{ text: string }>('/api/asr', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  getZenMuxStatus: () =>
    request<{
      configured: boolean;
      source: string;
      model: string;
      displayName: string;
    }>('/api/settings/zenmux'),

  verifyZenMuxKey: () =>
    request<{ valid: boolean; message: string }>('/api/settings/zenmux/verify', {
      method: 'POST',
    }),

  getDashScopeStatus: () =>
    request<{
      configured: boolean;
      source: string;
      model: string;
      displayName: string;
    }>('/api/settings/dashscope'),

  verifyDashScopeKey: () =>
    request<{ valid: boolean; message: string }>('/api/settings/dashscope/verify', {
      method: 'POST',
    }),

  synthesizeSpeech: (body: { text: string; voice?: string; dialect?: 'mandarin' | 'cantonese' }) =>
    request<{ audioUrl: string; audioBase64: string }>('/api/tts', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  listGroups: () => request<GroupListItem[]>('/api/groups'),

  createGroup: (name: string) =>
    request<Group>('/api/groups', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),

  joinGroup: (inviteCode: string) =>
    request<Group>('/api/groups/join', {
      method: 'POST',
      body: JSON.stringify({ inviteCode }),
    }),

  listGroupMembers: (groupId: string) =>
    request<GroupMember[]>(`/api/groups/${groupId}/members`),

  listTopics: (groupId: string) =>
    request<Topic[]>(`/api/groups/${groupId}/topics`),

  createTopic: (groupId: string, title?: string) =>
    request<Topic>(`/api/groups/${groupId}/topics`, {
      method: 'POST',
      body: JSON.stringify(title ? { title } : {}),
    }),

  updateTopic: (groupId: string, topicId: string, title: string) =>
    request<Topic>(`/api/groups/${groupId}/topics/${topicId}`, {
      method: 'PATCH',
      body: JSON.stringify({ title }),
    }),

  listGroupMessages: (
    groupId: string,
    topicId: string,
    opts?: { after?: string; since?: string },
  ) => {
    const q = new URLSearchParams();
    if (opts?.after) q.set('after', opts.after);
    if (opts?.since) q.set('since', opts.since);
    const qs = q.toString() ? `?${q}` : '';
    return request<GroupMessage[]>(
      `/api/groups/${groupId}/topics/${topicId}/messages${qs}`,
    );
  },

  sendGroupMessage: (
    groupId: string,
    topicId: string,
    content: string,
    attachmentIds?: string[],
  ) =>
    request<GroupMessage>(`/api/groups/${groupId}/topics/${topicId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content, attachmentIds }),
    }),

  markGroupLlmExclude: (groupId: string, topicId: string, messageId: string) =>
    request<GroupMessage>(
      `/api/groups/${groupId}/topics/${topicId}/messages/${messageId}/llm-exclude`,
      { method: 'POST' },
    ),

  cancelGroupLlmExclude: (groupId: string, topicId: string, messageId: string) =>
    request<GroupMessage>(
      `/api/groups/${groupId}/topics/${topicId}/messages/${messageId}/llm-exclude/cancel`,
      { method: 'POST' },
    ),

  uploadMedia: (body: { mimeType: string; dataUrl: string }) =>
    request<{ id: string; mimeType: string }>('/api/media/upload', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  invokeGroupLlm: (
    groupId: string,
    topicId: string,
    body: {
      instruction: string;
      selectedMessageIds?: string[];
      contextSelection?: ContextSelection;
      model?: string;
    },
  ) =>
    request<{ job: LlmInvokeJob; message: GroupMessage; invokeMessage: GroupMessage }>(
      `/api/groups/${groupId}/topics/${topicId}/llm/invoke`,
      { method: 'POST', body: JSON.stringify(body) },
    ),

  getGroupContextUsage: (groupId: string, topicId: string, pending?: string) => {
    const q = pending?.trim() ? `?pending=${encodeURIComponent(pending.trim())}` : '';
    return request<ContextUsage>(
      `/api/groups/${groupId}/topics/${topicId}/context-usage${q}`,
    );
  },

  getGroupContextPreview: (
    groupId: string,
    topicId: string,
    params: { pending?: string; contextSelection?: ContextSelection },
  ) => {
    const q = new URLSearchParams();
    if (params.pending?.trim()) q.set('pending', params.pending.trim());
    const base = q.toString() ? `?${q}` : '?';
    return request<ContextPreview>(
      `/api/groups/${groupId}/topics/${topicId}/context-preview${base}${contextSelectionQuery(params.contextSelection)}`,
    );
  },

  getWritingContextPreview: (
    documentId: string,
    params: {
      chapterTitle: string;
      chapterContent: string;
      documentExcerpt: string;
      pending?: string;
      contextSelection?: ContextSelection;
    },
  ) => {
    const q = new URLSearchParams({
      chapterTitle: params.chapterTitle,
      chapterContent: params.chapterContent,
      documentExcerpt: params.documentExcerpt,
    });
    if (params.pending?.trim()) q.set('pending', params.pending.trim());
    return request<ContextPreview>(
      `/api/documents/${documentId}/assistant/context-preview?${q}${contextSelectionQuery(params.contextSelection)}`,
    );
  },

  exportTopic: (groupId: string, topicId: string) =>
    request<{ markdown: string; messageCount: number }>(
      `/api/groups/${groupId}/topics/${topicId}/export`,
    ),

  exportChatSession: (sessionId: string) =>
    request<{ markdown: string; messageCount: number }>(
      `/api/chat/sessions/${sessionId}/export`,
    ),

  getAiProfile: () => request<UserAiProfile>('/api/users/me/ai-profile'),

  getPersona: () => request<UserPersonaSettings>('/api/users/me/persona'),

  patchPersona: (patch: UserPersonaSettings) =>
    request<UserPersonaSettings>('/api/users/me/persona', {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  updateAiProfile: (patch: Partial<UserAiProfile>) =>
    request<UserAiProfile>('/api/users/me/ai-profile', {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  patchProfile: (displayName: string) =>
    request<{ user: User; tokens: AuthTokens }>('/api/users/me', {
      method: 'PATCH',
      body: JSON.stringify({ displayName }),
    }),

  uploadProfileAvatar: (body: {
    mimeType: string;
    originalDataUrl: string;
    displayDataUrl: string;
  }) =>
    request<{ user: User; tokens: AuthTokens }>('/api/users/me/avatar', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  getProfileHistory: () => request<UserProfileHistory>('/api/users/me/profile-history'),

  analyzeIntent: (body: {
    text: string;
    channel: 'private' | 'group' | 'writing';
    aiMode?: boolean;
    hasAttachments?: boolean;
    sessionId?: string;
    groupId?: string;
    topicId?: string;
  }) =>
    request<IntentAnalyzeResult>('/api/intent/analyze', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  executeIntent: (body: {
    text: string;
    kind: IntentKind;
    slots?: MemoryIntentSlots;
    targetFragmentId?: string;
    channel: 'private' | 'group' | 'writing';
    sessionId?: string;
    groupId?: string;
    topicId?: string;
    model?: string;
    selectedMessageIds?: string[];
    contextSelection?: ContextSelection;
  }) =>
    request<IntentExecuteResult>('/api/intent/execute', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  listMemories: (params: {
    scope: 'user' | 'topic' | 'session';
    groupId?: string;
    topicId?: string;
    sessionId?: string;
    category?: MemoryCategory;
    includeSuppressed?: boolean;
  }) => {
    const q = new URLSearchParams({ scope: params.scope });
    if (params.groupId) q.set('groupId', params.groupId);
    if (params.topicId) q.set('topicId', params.topicId);
    if (params.sessionId) q.set('sessionId', params.sessionId);
    if (params.category) q.set('category', params.category);
    if (params.includeSuppressed) q.set('includeSuppressed', '1');
    return request<MemoryFragment[]>(`/api/memory?${q.toString()}`);
  },

  listMemoryVersions: (fragmentId: string) =>
    request<import('@xzz/shared').MemoryFragmentVersion[]>(
      `/api/memory/${fragmentId}/versions`,
    ),

  getMemorySettings: () => request<UserMemorySettings>('/api/memory/settings'),

  patchMemorySettings: (body: Partial<UserMemorySettings>) =>
    request<UserMemorySettings>('/api/memory/settings', {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  listMemoryReview: (limit = 50) =>
    request<MemoryFragment[]>(`/api/memory/review?limit=${limit}`),

  /** @deprecated 使用 listMemoryReview */
  listPendingMemories: () => request<MemoryFragment[]>('/api/memory/pending'),

  dismissMemoryReview: (id: string) =>
    request<{ fragment: MemoryFragment }>(`/api/memory/review/${id}/dismiss`, {
      method: 'POST',
    }),

  searchSessionMessages: (params: {
    q: string;
    sessionId?: string;
    groupId?: string;
    topicId?: string;
    limit?: number;
  }) => {
    const q = new URLSearchParams({ q: params.q });
    if (params.sessionId) q.set('sessionId', params.sessionId);
    if (params.groupId) q.set('groupId', params.groupId);
    if (params.topicId) q.set('topicId', params.topicId);
    if (params.limit != null) q.set('limit', String(params.limit));
    return request<MemorySessionSearchHit[]>(`/api/memory/search-sessions?${q.toString()}`);
  },

  sessionAutoExtract: (sessionId: string) =>
    request<{ created: number }>(
      `/api/memory/sessions/${sessionId}/auto-extract`,
      { method: 'POST' },
    ),

  topicAutoExtract: (groupId: string, topicId: string) =>
    request<{ created: number }>('/api/memory/topics/auto-extract', {
      method: 'POST',
      body: JSON.stringify({ groupId, topicId }),
    }),

  createMemory: (body: {
    scope: 'user' | 'topic' | 'session';
    content: string;
    title?: string;
    category?: MemoryCategory;
    groupId?: string;
    topicId?: string;
    sessionId?: string;
    sourceMessageId?: string;
  }) =>
    request<{ fragment: MemoryFragment }>('/api/memory', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  patchMemory: (
    id: string,
    body: {
      content?: string;
      status?: 'active' | 'suppressed' | 'deleted' | 'pending';
    },
  ) =>
    request<unknown>(`/api/memory/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  deleteMemory: (id: string) =>
    request<unknown>(`/api/memory/${id}`, { method: 'DELETE' }),

  btwAsk: (question: string, opts?: { groupId?: string; topicId?: string }) =>
    request<{ question: string; answer: string }>('/api/btw', {
      method: 'POST',
      body: JSON.stringify({ question, ...opts }),
    }),

  listLlmLogs: (limit = 50) =>
    request<LlmRequestLogListItem[]>(`/api/llm-logs?limit=${limit}`),

  getLlmLog: (id: string) => request<LlmRequestLogDetail>(`/api/llm-logs/${id}`),
};
