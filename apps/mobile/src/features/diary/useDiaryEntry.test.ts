import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { DiaryEntry } from '@xzz/shared';

const mockGetDiary = jest.fn();
const mockGenerate = jest.fn();
const mockRefine = jest.fn();
const mockConfirm = jest.fn();
jest.mock('../../lib/api', () => ({
  api: {
    getDiary: (...a: unknown[]) => mockGetDiary(...a),
    generateDiary: (...a: unknown[]) => mockGenerate(...a),
    refineDiary: (...a: unknown[]) => mockRefine(...a),
    confirmDiary: (...a: unknown[]) => mockConfirm(...a),
  },
}));

import { useDiaryEntry } from './useDiaryEntry';

const ok = (data: DiaryEntry) => ({ ok: true as const, data, requestId: 'x' });
function ent(over: Partial<DiaryEntry> = {}): DiaryEntry {
  return {
    id: 'd1', scope: 'self', scopeId: '', dayKey: '2026-06-20', summary: '今天',
    status: 'draft', sourceCount: 2, createdAt: '2026-06-20T00:00:00.000Z',
    updatedAt: '2026-06-20T00:00:00.000Z', ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

it('挂载拉取已有篇 → entry 填充、loading 结束', async () => {
  mockGetDiary.mockResolvedValue(ok(ent({ summary: '已存在' })));
  const { result } = renderHook(() => useDiaryEntry('self', '', '2026-06-20'));
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.entry?.summary).toBe('已存在');
  expect(result.current.error).toBeNull();
});

it('404 → entry 留 null,无 error(该天还没生成)', async () => {
  mockGetDiary.mockRejectedValue(Object.assign(new Error('nf'), { status: 404 }));
  const { result } = renderHook(() => useDiaryEntry('self', '', '2026-06-20'));
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.entry).toBeNull();
  expect(result.current.error).toBeNull();
});

it('非 404 首拉失败 → loadError=true、entry 留 null、无动作 error;reload 重试成功后恢复', async () => {
  mockGetDiary.mockRejectedValueOnce(Object.assign(new Error('boom'), { status: 500 }));
  const { result } = renderHook(() => useDiaryEntry('self', '', '2026-06-20'));
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.loadError).toBe(true);
  expect(result.current.entry).toBeNull();
  expect(result.current.error).toBeNull();

  mockGetDiary.mockResolvedValueOnce(ok(ent({ summary: '重试到了' })));
  await act(async () => {
    result.current.reload();
  });
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.loadError).toBe(false);
  expect(result.current.entry?.summary).toBe('重试到了');
});

it('refine 成功返回 true、失败返回 false 且保留旧篇 + 置 error', async () => {
  mockGetDiary.mockResolvedValue(ok(ent({ summary: '原文' })));
  const { result } = renderHook(() => useDiaryEntry('self', '', '2026-06-20'));
  await waitFor(() => expect(result.current.loading).toBe(false));

  mockRefine.mockRejectedValueOnce(new Error('refine 挂了'));
  let okRefine: boolean | undefined;
  await act(async () => {
    okRefine = await result.current.refine('写温暖点');
  });
  expect(okRefine).toBe(false);
  expect(result.current.entry?.summary).toBe('原文');
  expect(result.current.error).toBe('refine 挂了');

  mockRefine.mockResolvedValueOnce(ok(ent({ summary: '改后' })));
  await act(async () => {
    okRefine = await result.current.refine('再试一次');
  });
  expect(okRefine).toBe(true);
  expect(result.current.entry?.summary).toBe('改后');
  expect(result.current.error).toBeNull();
});

it('clearError 清掉动作 error', async () => {
  mockGetDiary.mockResolvedValue(ok(ent()));
  mockConfirm.mockRejectedValueOnce(new Error('确认失败'));
  const { result } = renderHook(() => useDiaryEntry('self', '', '2026-06-20'));
  await waitFor(() => expect(result.current.loading).toBe(false));
  await act(async () => {
    await result.current.confirm();
  });
  expect(result.current.error).toBe('确认失败');
  act(() => {
    result.current.clearError();
  });
  expect(result.current.error).toBeNull();
});

it('generate 用本地时区窗口拉取生成,更新 entry', async () => {
  mockGetDiary.mockRejectedValue(Object.assign(new Error('nf'), { status: 404 }));
  mockGenerate.mockResolvedValue(ok(ent({ summary: '生成的' })));
  const { result } = renderHook(() => useDiaryEntry('self', '', '2026-06-20'));
  await waitFor(() => expect(result.current.loading).toBe(false));
  await act(async () => {
    await result.current.generate();
  });
  expect(mockGenerate).toHaveBeenCalledWith('self', '', '2026-06-20', expect.any(String), expect.any(String));
  expect(result.current.entry?.summary).toBe('生成的');
});

it('refine:空意见不调用;非空调用并更新', async () => {
  mockGetDiary.mockResolvedValue(ok(ent()));
  mockRefine.mockResolvedValue(ok(ent({ summary: '改后', status: 'draft' })));
  const { result } = renderHook(() => useDiaryEntry('self', '', '2026-06-20'));
  await waitFor(() => expect(result.current.loading).toBe(false));
  await act(async () => {
    await result.current.refine('   ');
  });
  expect(mockRefine).not.toHaveBeenCalled();
  await act(async () => {
    await result.current.refine('写温暖点');
  });
  expect(mockRefine).toHaveBeenCalledWith('self', '', '2026-06-20', '写温暖点');
  expect(result.current.entry?.summary).toBe('改后');
});

it('confirm 调用并更新状态', async () => {
  mockGetDiary.mockResolvedValue(ok(ent()));
  mockConfirm.mockResolvedValue(ok(ent({ status: 'distilled' })));
  const { result } = renderHook(() => useDiaryEntry('self', '', '2026-06-20'));
  await waitFor(() => expect(result.current.loading).toBe(false));
  await act(async () => {
    await result.current.confirm();
  });
  expect(mockConfirm).toHaveBeenCalledWith('self', '', '2026-06-20');
  expect(result.current.entry?.status).toBe('distilled');
});
