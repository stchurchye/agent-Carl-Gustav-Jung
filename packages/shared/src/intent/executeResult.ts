import type { ChatMessage } from '../types.js';
import type { GroupMessage } from '../social.js';
import type { UserPersonaSettings } from '../persona/types.js';

export type IntentExecuteResult =
  | {
      type: 'chat';
      userMessage: ChatMessage;
      assistantMessage: ChatMessage;
    }
  | {
      type: 'group';
      invokeMessage: GroupMessage;
      aiMessage: GroupMessage;
    }
  | {
      type: 'group_human';
      message: GroupMessage;
    }
  | {
      type: 'memory';
      userMessage?: ChatMessage;
      assistantMessage?: ChatMessage;
      groupMessages?: GroupMessage[];
      confirmation: string;
    }
  | {
      type: 'tool';
      userMessage?: ChatMessage;
      assistantMessage?: ChatMessage;
      groupMessages?: GroupMessage[];
      confirmation: string;
      /** persona_rename:改名后的最新 persona,mobile 据此即时刷新狗名 */
      personaUpdated?: UserPersonaSettings;
    }
  | { type: 'skipped'; reason: string }
  | {
      type: 'agent';
      runId: string;
      userMessageId: string | null;
      placeholderMessageId: string | null;
      confirmation?: string;
      // M7：本次请求被合并到既有 active run；mobile 据此显示"已合并"提示。
      mergedIntoRunId?: string;
      // M7：本次请求被排队；mobile 据此显示"排队中·前 N 个"。
      queued?: boolean;
      queuePosition?: number;
    };
