/** 客户端跳转目标（app_navigate 意图） */
export type AppNavigateTarget =
  | 'personality'
  | 'personality_identity'
  | 'personality_soul'
  | 'personality_user'
  | 'memory_long'
  | 'memory_short'
  | 'memory_session'
  | 'memory_topic'
  | 'llm_logs'
  | 'client_logs'
  | 'api_keys'
  | 'voice'
  | 'export'
  | 'documents'
  | 'profile'
  | 'studio_settings';
