export type TaskType =
  | 'intent_classify'
  | 'chat_reply'
  | 'chat_reply_vision'
  | 'context_compact'
  | 'memory_extract'
  | 'memory_consolidate'
  | 'memory_auto_extract'
  | 'session_title'
  | 'magi_system_query'
  | 'magi_content_ingest'
  | 'human_only'
  | 'btw_reply';

export type TaskProvider = 'deepseek' | 'zenmux' | 'magi_system' | 'magi_content' | 'none';

export interface TaskProfile {
  taskType: TaskType;
  provider: TaskProvider;
  model: string;
  maxTokens: number;
  temperature: number;
  requiresVision: boolean;
  estimatedCostTier: 'low' | 'medium' | 'high';
}

export const DEFAULT_TASK_PROFILES: Record<TaskType, TaskProfile> = {
  intent_classify: {
    taskType: 'intent_classify',
    provider: 'deepseek',
    model: 'deepseek-chat',
    maxTokens: 512,
    temperature: 0,
    requiresVision: false,
    estimatedCostTier: 'low',
  },
  chat_reply: {
    taskType: 'chat_reply',
    provider: 'deepseek',
    model: 'deepseek-v4-pro',
    maxTokens: 8192,
    temperature: 0.7,
    requiresVision: false,
    estimatedCostTier: 'high',
  },
  chat_reply_vision: {
    taskType: 'chat_reply_vision',
    provider: 'zenmux',
    model: 'google/gemini-2.0-flash-lite-001',
    maxTokens: 4096,
    temperature: 0.5,
    requiresVision: true,
    estimatedCostTier: 'medium',
  },
  context_compact: {
    taskType: 'context_compact',
    provider: 'deepseek',
    model: 'deepseek-v4-pro',
    maxTokens: 2048,
    temperature: 0.2,
    requiresVision: false,
    estimatedCostTier: 'low',
  },
  memory_extract: {
    taskType: 'memory_extract',
    provider: 'deepseek',
    model: 'deepseek-v4-pro',
    maxTokens: 1024,
    temperature: 0.3,
    requiresVision: false,
    estimatedCostTier: 'medium',
  },
  memory_consolidate: {
    taskType: 'memory_consolidate',
    provider: 'deepseek',
    model: 'deepseek-chat',
    maxTokens: 2048,
    temperature: 0,
    requiresVision: false,
    estimatedCostTier: 'low',
  },
  memory_auto_extract: {
    taskType: 'memory_auto_extract',
    provider: 'deepseek',
    model: 'deepseek-chat',
    maxTokens: 1024,
    temperature: 0.2,
    requiresVision: false,
    estimatedCostTier: 'medium',
  },
  session_title: {
    taskType: 'session_title',
    provider: 'deepseek',
    model: 'deepseek-chat',
    maxTokens: 64,
    temperature: 0.3,
    requiresVision: false,
    estimatedCostTier: 'low',
  },
  magi_system_query: {
    taskType: 'magi_system_query',
    provider: 'magi_system',
    model: 'magi-system',
    maxTokens: 4096,
    temperature: 0.2,
    requiresVision: false,
    estimatedCostTier: 'medium',
  },
  magi_content_ingest: {
    taskType: 'magi_content_ingest',
    provider: 'magi_content',
    model: 'magi-content',
    maxTokens: 2048,
    temperature: 0.2,
    requiresVision: false,
    estimatedCostTier: 'medium',
  },
  human_only: {
    taskType: 'human_only',
    provider: 'none',
    model: '',
    maxTokens: 0,
    temperature: 0,
    requiresVision: false,
    estimatedCostTier: 'low',
  },
  btw_reply: {
    taskType: 'btw_reply',
    provider: 'deepseek',
    model: 'deepseek-v4-pro',
    maxTokens: 4096,
    temperature: 0.7,
    requiresVision: false,
    estimatedCostTier: 'medium',
  },
};

export function pickTaskProfile(input: {
  hasAttachments: boolean;
  intentKind: string;
}): TaskProfile {
  if (input.intentKind === 'human_group_message') {
    return DEFAULT_TASK_PROFILES.human_only;
  }
  if (input.intentKind === 'magi_system_query') {
    return DEFAULT_TASK_PROFILES.magi_system_query;
  }
  if (input.intentKind === 'magi_content_link') {
    return DEFAULT_TASK_PROFILES.magi_content_ingest;
  }
  if (input.intentKind === 'context_compact') {
    return DEFAULT_TASK_PROFILES.context_compact;
  }
  if (input.hasAttachments) {
    return DEFAULT_TASK_PROFILES.chat_reply_vision;
  }
  return DEFAULT_TASK_PROFILES.chat_reply;
}
