/**
 * M6 T4：youtube_transcript 工具单测。Mock youtube-transcript npm 包。
 *
 * 注意 ToolDef.handler 签名：`(input, ctx) => Promise<O>`（两个位置参数）
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

vi.mock('youtube-transcript', () => ({
  YoutubeTranscript: {
    fetchTranscript: vi.fn(),
  },
}));

import { YoutubeTranscript } from 'youtube-transcript';
import { youtubeTranscriptTool } from '../tools/youtubeTranscript.js';
import type { ToolCtx } from '../toolRegistry.js';

const originalFetch = global.fetch;

function makeCtx(): ToolCtx {
  return {
    runId: 'r1',
    stepId: 's1',
    ownerId: 'u1',
    channel: 'private',
    signal: new AbortController().signal,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    text: async () => '<html><title>Test Video Title - YouTube</title></html>',
  } as Response);
});

afterAll(() => {
  global.fetch = originalFetch;
});

describe('youtube_transcript tool', () => {
  it('parses watch URL → videoId, fetches transcript, returns concatenated text', async () => {
    (YoutubeTranscript.fetchTranscript as any).mockResolvedValue([
      { text: 'Hello', offset: 0, duration: 2000 },
      { text: 'world', offset: 2000, duration: 2000 },
    ]);
    const result: any = await youtubeTranscriptTool.handler(
      { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
      makeCtx(),
    );
    expect(result.ok).toBe(true);
    expect(result.videoId).toBe('dQw4w9WgXcQ');
    expect(result.transcript).toBe('Hello world');
    expect(result.chunks).toHaveLength(2);
    expect(result.title).toBe('Test Video Title');
    expect(result.truncated).toBe(false);
  });

  it('parses short URL (youtu.be/<id>)', async () => {
    (YoutubeTranscript.fetchTranscript as any).mockResolvedValue([
      { text: 'a', offset: 0, duration: 100 },
    ]);
    const result: any = await youtubeTranscriptTool.handler(
      { url: 'https://youtu.be/abc123XYZ_-' },
      makeCtx(),
    );
    expect(result.ok).toBe(true);
    expect(result.videoId).toBe('abc123XYZ_-');
  });

  it('accepts bare video id', async () => {
    (YoutubeTranscript.fetchTranscript as any).mockResolvedValue([
      { text: 'a', offset: 0, duration: 100 },
    ]);
    const result: any = await youtubeTranscriptTool.handler(
      { url: 'dQw4w9WgXcQ' },
      makeCtx(),
    );
    expect(result.ok).toBe(true);
    expect(result.videoId).toBe('dQw4w9WgXcQ');
  });

  it('invalid URL → ok:false reason:invalid_url', async () => {
    const result: any = await youtubeTranscriptTool.handler(
      { url: 'not-a-url' },
      makeCtx(),
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('invalid_url');
  });

  it('YoutubeTranscript.fetchTranscript throws → ok:false reason:fetch_failed', async () => {
    (YoutubeTranscript.fetchTranscript as any).mockRejectedValue(
      new Error('no transcript available'),
    );
    const result: any = await youtubeTranscriptTool.handler(
      { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
      makeCtx(),
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('fetch_failed');
    expect(result.videoId).toBe('dQw4w9WgXcQ');
  });

  it('transcript > 30000 chars → truncated:true and text length === 30000', async () => {
    const chunks = Array.from({ length: 1000 }, (_, i) => ({
      text: 'a'.repeat(50),
      offset: i * 100,
      duration: 100,
    }));
    (YoutubeTranscript.fetchTranscript as any).mockResolvedValue(chunks);
    const result: any = await youtubeTranscriptTool.handler(
      { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
      makeCtx(),
    );
    expect(result.ok).toBe(true);
    expect(result.truncated).toBe(true);
    expect(result.transcript.length).toBe(30000);
  });

  it('title fetch fails → fallback title=videoId, transcript still returned', async () => {
    (YoutubeTranscript.fetchTranscript as any).mockResolvedValue([
      { text: 'a', offset: 0, duration: 100 },
    ]);
    (global.fetch as any).mockRejectedValue(new Error('network'));
    const result: any = await youtubeTranscriptTool.handler(
      { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
      makeCtx(),
    );
    expect(result.ok).toBe(true);
    expect(result.title).toBe('dQw4w9WgXcQ');
    expect(result.transcript).toBe('a');
  });
});
