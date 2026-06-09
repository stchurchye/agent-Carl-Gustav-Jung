import { renderHook, act, waitFor } from '@testing-library/react-native';

// 注:jest.mock 工厂在 const 初始化前运行(ES import 提升),故用闭包**延迟**引用 mock fn,
// 不能在工厂里直接展开一个对象(会拿到 undefined)。
const mockGetPersona = jest.fn();
const mockListMemories = jest.fn();
const mockListMemoryReview = jest.fn();
const mockListLlmLogs = jest.fn();
const mockGetMemorySettings = jest.fn();
const mockListSkills = jest.fn();
const mockListAgentMemory = jest.fn();
jest.mock('../lib/api', () => ({
  api: {
    getPersona: () => mockGetPersona(),
    listMemories: (a: unknown) => mockListMemories(a),
    listMemoryReview: (a: unknown) => mockListMemoryReview(a),
    listLlmLogs: (a: unknown) => mockListLlmLogs(a),
    getMemorySettings: () => mockGetMemorySettings(),
    listSkills: () => mockListSkills(),
    listAgentMemory: (s: unknown) => mockListAgentMemory(s),
  },
}));

import { useBrainSnapshot } from './useBrainSnapshot';

beforeEach(() => {
  mockGetPersona.mockReset().mockResolvedValue({ data: {} });
  mockListMemories.mockReset().mockResolvedValue({ data: [] });
  mockListMemoryReview.mockReset().mockResolvedValue({ data: [] });
  mockListLlmLogs.mockReset().mockResolvedValue({ data: [] });
  mockGetMemorySettings.mockReset().mockResolvedValue({ data: { autoExtractEnabled: false } });
  mockListSkills.mockReset().mockResolvedValue({
    data: { skills: [
      { id: 'a', enabled: false },
      { id: 'b', enabled: false },
      { id: 'c', enabled: true }, // 已启用,不计入待审
    ] },
  });
  mockListAgentMemory.mockReset().mockResolvedValue({ data: { items: [{ id: 1 }, { id: 2 }, { id: 3 }] } });
});

describe('useBrainSnapshot M5 polish 计数', () => {
  it('pendingSkillCount 只数 enabled=false；pendingEpisodicCount = 待审情景记忆数', async () => {
    const { result } = renderHook(() => useBrainSnapshot());
    await act(async () => { await result.current.refresh(); });
    await waitFor(() => expect(result.current.snapshot).not.toBeNull());
    expect(result.current.snapshot!.pendingSkillCount).toBe(2);
    expect(result.current.snapshot!.pendingEpisodicCount).toBe(3);
    expect(mockListAgentMemory).toHaveBeenCalledWith('pending'); // 只数待审,非全部
  });

  it('listSkills / listAgentMemory 失败 → 计数 0(fail-open),其余快照仍成功', async () => {
    mockListSkills.mockRejectedValue(new Error('boom'));
    mockListAgentMemory.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useBrainSnapshot());
    await act(async () => { await result.current.refresh(); });
    await waitFor(() => expect(result.current.snapshot).not.toBeNull());
    expect(result.current.snapshot!.pendingSkillCount).toBe(0);
    expect(result.current.snapshot!.pendingEpisodicCount).toBe(0);
    expect(result.current.error).toBeNull(); // 单项 fail-open,不致整体失败
  });
});
