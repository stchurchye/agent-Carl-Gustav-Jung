import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../store/pg-intelligence.js', () => ({
  listMemoryFragments: vi.fn(),
}));

import * as intel from '../store/pg-intelligence.js';
import { retrieveMemoriesForContext } from './memoryRetrieve.js';

const listMemoryFragments = vi.mocked(intel.listMemoryFragments);

describe('retrieveMemoriesForContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('splits user fragments into profile and project notes by category', async () => {
    listMemoryFragments.mockImplementation(async (_userId, scope) => {
      if (scope === 'user') {
        return [
          {
            id: '1',
            title: '称呼',
            content: '叫我阿王',
            category: 'user_profile',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
          {
            id: '2',
            title: '栈',
            content: 'Expo + Hono',
            category: 'project_note',
            updatedAt: '2026-01-02T00:00:00.000Z',
          },
        ];
      }
      return [];
    });

    const result = await retrieveMemoriesForContext({
      userId: 'u1',
      query: '技术',
    });

    expect(result.userProfile).toEqual([{ title: '称呼', content: '叫我阿王' }]);
    expect(result.projectNotes).toEqual([{ title: '栈', content: 'Expo + Hono' }]);
    expect(result.shortTerm).toEqual([]);
  });

  it('loads session short-term memories when sessionId provided', async () => {
    listMemoryFragments.mockImplementation(async (_userId, scope, opts) => {
      if (scope === 'user') return [];
      if (scope === 'session' && opts?.sessionId === 's1') {
        return [
          {
            id: '3',
            title: '本轮',
            content: '正在写测试',
            category: 'general',
            updatedAt: '2026-01-03T00:00:00.000Z',
          },
        ];
      }
      return [];
    });

    const result = await retrieveMemoriesForContext({
      userId: 'u1',
      sessionId: 's1',
      query: '测试',
    });

    expect(result.shortTerm).toEqual([{ title: '本轮', content: '正在写测试' }]);
  });
});
