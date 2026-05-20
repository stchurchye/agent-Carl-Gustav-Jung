/**
 * 记忆容量上限（对齐 Hermes Agent MEMORY.md / USER.md）
 * @see https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/memory.md
 */
/** USER.md — 关于用户的偏好、称呼、习惯 */
export const MEMORY_USER_PROFILE_CHAR_LIMIT = 1375;

/** MEMORY.md — 项目、环境、工作流与教训 */
export const MEMORY_PROJECT_NOTE_CHAR_LIMIT = 2200;

/** user scope 库内总字数，超出则触发 consolidate */
export const MEMORY_USER_SCOPE_CHAR_BUDGET =
  MEMORY_USER_PROFILE_CHAR_LIMIT + MEMORY_PROJECT_NOTE_CHAR_LIMIT;

/** session / topic 短记忆注入上限（Hermes 无对等物；略高于原 400 以容纳更多本会话/话题条目） */
export const MEMORY_SHORT_TERM_CHAR_LIMIT = 600;

/** 召回候选池大小（DB 拉取后再打分截断） */
export const MEMORY_CANDIDATE_POOL_LIMIT = 50;
