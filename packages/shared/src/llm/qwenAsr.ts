/** 阿里云百炼 Qwen-ASR（OpenAI 兼容，北京地域） */
export const DASHSCOPE_COMPAT_BASE_URL =
  'https://dashscope.aliyuncs.com/compatible-mode/v1';

export const DASHSCOPE_ASR_ENDPOINT =
  `${DASHSCOPE_COMPAT_BASE_URL}/chat/completions`;

/** 同步语音识别（按住说话） */
export const QWEN_ASR_MODEL = 'qwen3-asr-flash';

/** 单次请求音频建议上限（Base64 后约 10MB） */
export const QWEN_ASR_MAX_BASE64_CHARS = 10_000_000;
