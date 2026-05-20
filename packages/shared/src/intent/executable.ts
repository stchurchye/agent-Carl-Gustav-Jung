import type { IntentKind } from '../social.js';

/** 移动端芯片与 /api/intent/execute 支持的意图 */
export const EXECUTABLE_INTENT_KINDS: IntentKind[] = [
  'chat_private_llm',
  'chat_group_llm',
  'human_group_message',
  'memory_remember',
  'memory_correct',
  'memory_forget',
  'context_compact',
  'magi_system_query',
  'magi_content_link',
  'app_navigate',
  'agent_run',
  'persona_open_settings',
];

const EXECUTABLE_SET = new Set<IntentKind>(EXECUTABLE_INTENT_KINDS);

export function isExecutableIntentKind(kind: IntentKind): boolean {
  return EXECUTABLE_SET.has(kind);
}
