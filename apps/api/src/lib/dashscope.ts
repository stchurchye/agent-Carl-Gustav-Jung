import {
  DASHSCOPE_ASR_ENDPOINT,
  DASHSCOPE_TTS_ENDPOINT,
  QWEN_ASR_MAX_BASE64_CHARS,
  QWEN_ASR_MODEL,
  QWEN_TTS_MAX_CHARS,
  QWEN_TTS_MODEL,
  resolveQwenVoiceForDialect,
  type QwenTtsDialect,
} from '@xzz/shared';

export class DashScopeError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
    this.name = 'DashScopeError';
  }
}

export function getDashScopeKeyFromRequest(headerKey?: string | null): string {
  const fromHeader = headerKey?.trim();
  if (fromHeader) return fromHeader;
  const fromEnv = process.env.DASHSCOPE_API_KEY?.trim();
  if (!fromEnv) throw new DashScopeError('DASHSCOPE_KEY_MISSING');
  return fromEnv;
}

export function hasDashScopeKeyConfigured(headerKey?: string | null): boolean {
  return Boolean(headerKey?.trim() || process.env.DASHSCOPE_API_KEY?.trim());
}

type DashScopeTtsResponse = {
  status_code?: number;
  code?: string;
  message?: string;
  output?: {
    finish_reason?: string;
    audio?: { url?: string; data?: string };
  };
};

function parseDialect(raw?: string | null): QwenTtsDialect {
  return raw?.trim().toLowerCase() === 'cantonese' ? 'cantonese' : 'mandarin';
}

function toHttpsUrl(url: string): string {
  return url.replace(/^http:\/\//i, 'https://');
}

async function fetchAudioBase64(url: string): Promise<string> {
  const secure = toHttpsUrl(url);
  const res = await fetch(secure);
  if (!res.ok) {
    throw new DashScopeError(`音频下载失败（${res.status}）`, res.status);
  }
  return Buffer.from(await res.arrayBuffer()).toString('base64');
}

export async function qwen3TtsSynthesize(opts: {
  apiKey: string;
  text: string;
  voice?: string;
  dialect?: QwenTtsDialect | string;
}): Promise<{ audioUrl: string; audioBase64: string }> {
  const text = opts.text.trim();
  if (!text) throw new DashScopeError('朗读内容为空');
  if (text.length > QWEN_TTS_MAX_CHARS) {
    throw new DashScopeError(`单次朗读不超过 ${QWEN_TTS_MAX_CHARS} 字，请分段朗读`);
  }

  const dialect = parseDialect(opts.dialect);
  const voice = resolveQwenVoiceForDialect(dialect, opts.voice);

  const res = await fetch(DASHSCOPE_TTS_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify({
      model: QWEN_TTS_MODEL,
      input: {
        text,
        voice,
        language_type: 'chinese',
      },
    }),
  });

  const json = (await res.json()) as DashScopeTtsResponse;
  const rawUrl = json.output?.audio?.url?.trim();

  if (!res.ok || !rawUrl) {
    const msg =
      json.message ||
      json.code ||
      `Qwen3-TTS 请求失败（${res.status}）`;
    throw new DashScopeError(msg, res.status);
  }

  const audioUrl = toHttpsUrl(rawUrl);
  const audioBase64 = await fetchAudioBase64(audioUrl);
  return { audioUrl, audioBase64 };
}

export async function verifyDashScopeKey(apiKey: string): Promise<void> {
  await qwen3TtsSynthesize({
    apiKey,
    text: '您好，朗读测试。',
    dialect: 'mandarin',
  });
}

type QwenAsrCompletion = {
  error?: { message?: string };
  message?: string;
  choices?: Array<{ message?: { content?: string | unknown } }>;
};

function asrMimeForFormat(format: string): string {
  const f = format.toLowerCase();
  if (f === 'wav' || f === 'caf') return 'audio/wav';
  if (f === 'mp3') return 'audio/mpeg';
  if (f === 'm4a' || f === 'mp4' || f === 'aac') return 'audio/mp4';
  return 'audio/mp4';
}

function extractAsrText(content: unknown): string {
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object' && 'text' in part) {
          return String((part as { text?: string }).text ?? '');
        }
        return '';
      })
      .join('')
      .trim();
  }
  return '';
}

/** Qwen3-ASR-Flash：按住说话 / 云端听写 */
export async function qwen3AsrTranscribe(opts: {
  apiKey: string;
  audioBase64: string;
  format?: string;
}): Promise<string> {
  const audioBase64 = opts.audioBase64.trim();
  if (!audioBase64 || audioBase64.length < 32) {
    throw new DashScopeError('录音为空或过短');
  }
  if (audioBase64.length > QWEN_ASR_MAX_BASE64_CHARS) {
    throw new DashScopeError('录音太长，请按住说短一点');
  }

  const mime = asrMimeForFormat(opts.format ?? 'm4a');
  const dataUri = `data:${mime};base64,${audioBase64}`;

  const res = await fetch(DASHSCOPE_ASR_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify({
      model: QWEN_ASR_MODEL,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'input_audio',
              input_audio: { data: dataUri },
            },
          ],
        },
      ],
      stream: false,
      asr_options: {
        language: 'zh',
        enable_itn: true,
      },
    }),
  });

  const json = (await res.json()) as QwenAsrCompletion;
  const text = extractAsrText(json.choices?.[0]?.message?.content);

  if (!res.ok || !text) {
    const msg =
      json.error?.message ||
      json.message ||
      `Qwen 语音识别失败（${res.status}）`;
    throw new DashScopeError(msg, res.status);
  }

  return text;
}
