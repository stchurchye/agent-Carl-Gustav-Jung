/**
 * M6 T4：YouTube 视频字幕工具。
 *
 * 选型理由：
 *   - `youtube-transcript` npm 包：无 API key、无 OAuth、纯 client 解析（~50KB）
 *   - 缺点：依赖 YouTube 内部 timedtext 接口，可能某天失效 → soft-fail（ok:false）让 planner replan
 *
 * ToolDef 风格对齐 wikipedia.ts：导出 `youtubeTranscriptTool: ToolDef<I,O>` + register helper。
 */
import { YoutubeTranscript } from 'youtube-transcript';
import { toolRegistry, type ToolDef } from '../toolRegistry.js';

type YoutubeTranscriptInput = {
  url: string;
  lang?: 'zh-CN' | 'en' | 'auto';
};

type YoutubeTranscriptChunk = {
  text: string;
  offset: number;
  duration: number;
};

type YoutubeTranscriptOutput =
  | {
      ok: true;
      videoId: string;
      title: string;
      transcript: string;
      chunks: YoutubeTranscriptChunk[];
      lang: string;
      truncated: boolean;
    }
  | {
      ok: false;
      reason: 'invalid_url' | 'fetch_failed' | 'no_transcript';
      videoId?: string;
    };

const MAX_TRANSCRIPT_CHARS = 30000;
const TITLE_FETCH_TIMEOUT_MS = 3000;
const VIDEO_ID_RE = /^[a-zA-Z0-9_-]{11}$/;

function extractVideoId(input: string): string | null {
  const s = input.trim();
  if (VIDEO_ID_RE.test(s)) return s;

  try {
    const u = new URL(s);
    if (u.hostname === 'youtu.be') {
      const id = u.pathname.replace(/^\//, '');
      return VIDEO_ID_RE.test(id) ? id : null;
    }
    if (u.hostname.endsWith('youtube.com') || u.hostname.endsWith('youtube-nocookie.com')) {
      const v = u.searchParams.get('v');
      if (v && VIDEO_ID_RE.test(v)) return v;
      const shorts = u.pathname.match(/^\/shorts\/([a-zA-Z0-9_-]{11})/);
      if (shorts) return shorts[1];
      const embed = u.pathname.match(/^\/embed\/([a-zA-Z0-9_-]{11})/);
      if (embed) return embed[1];
    }
  } catch {
    return null;
  }
  return null;
}

async function fetchVideoTitle(videoId: string, parentSignal: AbortSignal): Promise<string> {
  const ctl = new AbortController();
  const onAbort = () => ctl.abort();
  parentSignal.addEventListener('abort', onAbort);
  const t = setTimeout(() => ctl.abort(), TITLE_FETCH_TIMEOUT_MS);
  try {
    const resp = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      signal: ctl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    if (!resp.ok) return videoId;
    const html = await resp.text();
    const m = html.match(/<title>([^<]+)<\/title>/);
    if (!m) return videoId;
    return m[1].replace(/\s*-\s*YouTube\s*$/, '').trim() || videoId;
  } catch {
    return videoId;
  } finally {
    clearTimeout(t);
    parentSignal.removeEventListener('abort', onAbort);
  }
}

export const youtubeTranscriptTool: ToolDef<YoutubeTranscriptInput, YoutubeTranscriptOutput> = {
  name: 'youtube_transcript',
  description:
    'Fetch transcript/captions of a YouTube video by URL or video ID. Returns concatenated text + per-chunk timing. Use this when the user shares a YouTube link and you need video content. Soft-fails on no captions or API errors.',
  inputSchema: {
    type: 'object',
    required: ['url'],
    properties: {
      url: {
        type: 'string',
        description: 'YouTube watch URL, short URL (youtu.be/...), shorts URL, or 11-char video ID.',
      },
      lang: {
        type: 'string',
        enum: ['zh-CN', 'en', 'auto'],
        description: 'Preferred caption language. Defaults to auto.',
      },
    },
  },
  approvalMode: 'auto',
  costHint: 'low',
  hasSideEffects: false,
  idempotent: true,
  computeIdempotencyKey: (input) => `yt:${input.lang ?? 'auto'}:${extractVideoId(input.url) ?? input.url}`,
  replyMeta: {
    summaryKind: 'text',
    failureHint:
      'YouTube transcript 失败一般是视频无字幕、被锁区或 API 临时不可用；可改用 fetch_url 抓视频描述页。',
    extractRef: (output) => {
      const o = output as YoutubeTranscriptOutput;
      if (!o?.ok) return null;
      return {
        kind: 'url' as const,
        id: `https://www.youtube.com/watch?v=${o.videoId}`,
        label: `YouTube: ${o.title}`,
      };
    },
  },
  async handler(input, ctx) {
    const videoId = extractVideoId(input.url);
    if (!videoId) {
      return { ok: false, reason: 'invalid_url' };
    }
    const lang = input.lang && input.lang !== 'auto' ? input.lang : undefined;

    // youtube-transcript@1.x does not accept an AbortSignal.
    // Use Promise.race against ctx.signal abort to bound the wait.
    let chunks: Awaited<ReturnType<typeof YoutubeTranscript.fetchTranscript>>;
    try {
      const abortPromise = new Promise<never>((_, reject) => {
        if (ctx.signal.aborted) {
          reject(new Error('aborted'));
          return;
        }
        ctx.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
      chunks = await Promise.race([
        YoutubeTranscript.fetchTranscript(videoId, lang ? { lang } : undefined),
        abortPromise,
      ]);
    } catch {
      return { ok: false, reason: 'fetch_failed', videoId };
    }
    if (!chunks || chunks.length === 0) {
      return { ok: false, reason: 'no_transcript', videoId };
    }

    const fullText = chunks.map((c) => c.text).join(' ');
    const truncated = fullText.length > MAX_TRANSCRIPT_CHARS;
    const transcript = truncated ? fullText.slice(0, MAX_TRANSCRIPT_CHARS) : fullText;

    const title = await fetchVideoTitle(videoId, ctx.signal);

    return {
      ok: true,
      videoId,
      title,
      transcript,
      chunks: chunks.map((c) => ({
        offset: (c as { offset?: number; start?: number }).offset ?? (c as { start?: number }).start ?? 0,
        duration: c.duration,
        text: c.text,
      })),
      lang: lang ?? 'auto',
      truncated,
    };
  },
};

export function registerYoutubeTranscript(): void {
  if (!toolRegistry.get(youtubeTranscriptTool.name)) {
    toolRegistry.register(youtubeTranscriptTool);
  }
}
