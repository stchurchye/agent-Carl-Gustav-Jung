import { renderHook, waitFor, act } from '@testing-library/react-native';

const mockGet = jest.fn();
const mockPatch = jest.fn();
jest.mock('./api', () => ({
  api: {
    getMemorySettings: (...a: unknown[]) => mockGet(...a),
    patchMemorySettings: (...a: unknown[]) => mockPatch(...a),
  },
}));
jest.mock('./appAlert', () => ({ appAlert: jest.fn() }));
// useFocusEffect 需 NavigationContainer;测试里降级成 useEffect(挂载即跑)。
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  const React = jest.requireActual('react');
  return { ...actual, useFocusEffect: (cb: () => void) => React.useEffect(cb, [cb]) };
});

import { useMemoryPrefs } from './useMemoryPrefs';

beforeEach(() => {
  mockGet.mockReset();
  mockPatch.mockReset();
});

// 行为:记忆偏好的共享逻辑 —— 挂载时载入 autoExtractEnabled;切换时乐观更新 + 持久化。
it('loads the auto-extract setting on mount', async () => {
  mockGet.mockResolvedValue({ data: { autoExtractEnabled: false } });
  const { result } = renderHook(() => useMemoryPrefs());

  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.enabled).toBe(false);
  expect(mockGet).toHaveBeenCalledTimes(1);
});

it('persists a toggle via patchMemorySettings (optimistic)', async () => {
  mockGet.mockResolvedValue({ data: { autoExtractEnabled: false } });
  mockPatch.mockResolvedValue({ data: { autoExtractEnabled: true } });
  const { result } = renderHook(() => useMemoryPrefs());
  await waitFor(() => expect(result.current.loading).toBe(false));

  act(() => result.current.onToggle(true));

  expect(result.current.enabled).toBe(true); // 乐观:立即反映
  expect(mockPatch).toHaveBeenCalledWith({ autoExtractEnabled: true });
});
