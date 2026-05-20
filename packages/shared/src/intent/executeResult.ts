import type { ChatMessage } from '../types.js';
import type { GroupMessage } from '../social.js';

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
    }
  | { type: 'skipped'; reason: string }
  | {
      type: 'agent';
      runId: string;
      userMessageId: string | null;
      placeholderMessageId: string | null;
      confirmation?: string;
    };
