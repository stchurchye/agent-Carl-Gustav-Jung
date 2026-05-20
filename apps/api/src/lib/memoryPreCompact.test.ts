import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./deepseek.js', () => ({
  chatCompletionRaw: vi.fn(),
}));

vi.mock('../store/pg-intelligence.js', () => ({
  getUserMemorySettings: vi.fn(),
  createMemoryFragment: vi.fn(),
}));

vi.mock('./memoryConsolidate.js', () => ({
  consolidateUserMemoriesIfNeeded: vi.fn(),
}));

import { chatCompletionRaw } from './deepseek.js';
import * as intel from '../store/pg-intelligence.js';
import {
  extractPreCompactMemories,
  salvageMemoriesBeforeCompact,
} from './memoryPreCompact.js';

const chatRaw = vi.mocked(chatCompletionRaw);
const getSettings = vi.mocked(intel.getUserMemorySettings);
const createFragment = vi.mocked(intel.createMemoryFragment);

describe('extractPreCompactMemories', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty when fewer than two messages', async () => {
    expect(
      await extractPreCompactMemories('key', [{ role: 'user', content: 'hi' }]),
    ).toEqual([]);
    expect(chatRaw).not.toHaveBeenCalled();
  });

  it('parses LLM JSON into salvage candidates', async () => {
    chatRaw.mockResolvedValue(
      '{"candidates":[{"title":"约定","content":"每周五发版","category":"project_note"}]}',
    );

    const out = await extractPreCompactMemories('key', [
      { role: 'user', content: '我们周五发版' },
      { role: 'assistant', content: '好的' },
    ]);

    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      title: '约定',
      content: '每周五发版',
      scope: 'session',
      category: 'project_note',
    });
  });
});

describe('salvageMemoriesBeforeCompact', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSettings.mockResolvedValue({ autoExtractEnabled: true });
    createFragment.mockResolvedValue({} as never);
  });

  it('skips when auto extract disabled', async () => {
    getSettings.mockResolvedValue({ autoExtractEnabled: false });

    const saved = await salvageMemoriesBeforeCompact({
      apiKey: 'key',
      userId: 'u1',
      messages: [
        { role: 'user', content: 'a' },
        { role: 'assistant', content: 'b' },
      ],
      scope: 'session',
      sessionId: 's1',
    });

    expect(saved).toBe(0);
    expect(chatRaw).not.toHaveBeenCalled();
  });

  it('creates active fragments when LLM returns candidates', async () => {
    chatRaw.mockResolvedValue(
      '{"candidates":[{"title":"偏好","content":"回复简短","category":"user_profile"}]}',
    );

    const saved = await salvageMemoriesBeforeCompact({
      apiKey: 'key',
      userId: 'u1',
      messages: [
        { role: 'user', content: '简短点' },
        { role: 'assistant', content: '好' },
      ],
      scope: 'session',
      sessionId: 's1',
    });

    expect(saved).toBe(1);
    expect(createFragment).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        scope: 'session',
        status: 'active',
        source: 'ai',
        category: 'user_profile',
      }),
    );
  });
});
