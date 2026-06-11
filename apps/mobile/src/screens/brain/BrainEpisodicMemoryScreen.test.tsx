import * as React from 'react';
import { Linking } from 'react-native';
import { render, waitFor, fireEvent } from '@testing-library/react-native';

const mockList = jest.fn();
const mockDecide = jest.fn();
const mockPromote = jest.fn();
const mockMarkTruth = jest.fn();
const mockRevalidate = jest.fn();
const mockNavigate = jest.fn();
const mockOpenURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined as never);

const mockListGroups = jest.fn();
jest.mock('../../lib/api', () => ({
  api: {
    listAgentMemory: (...a: unknown[]) => mockList(...a),
    decideAgentMemory: (...a: unknown[]) => mockDecide(...a),
    promoteAgentMemory: (...a: unknown[]) => mockPromote(...a),
    markTruthAgentMemory: (...a: unknown[]) => mockMarkTruth(...a),
    revalidateAgentMemory: (...a: unknown[]) => mockRevalidate(...a),
    listGroups: (...a: unknown[]) => mockListGroups(...a),
  },
}));
jest.mock('@react-navigation/native', () => {
  const React = jest.requireActual('react');
  return {
    useFocusEffect: (cb: () => void) => React.useEffect(cb, [cb]),
    useNavigation: () => ({ canGoBack: () => false, goBack: jest.fn(), navigate: mockNavigate }),
  };
});

import { BrainEpisodicMemoryScreen } from './BrainEpisodicMemoryScreen';
import type { AgentMemoryItem } from '../../lib/api';

const finding = (over?: Partial<AgentMemoryItem>): AgentMemoryItem => ({
  id: 9,
  text: '损失厌恶系数约 2.25',
  status: 'approved',
  confidence: 0.9,
  createdAt: '2026-06-10T00:00:00+00:00',
  validUntil: null,
  sourceRunId: 'run-9',
  kind: 'finding',
  sentiment: null,
  sourceFragmentIds: null,
  promotedAt: null,
  sources: [{ url: 'https://doi.org/10.1/tk', title: 'Prospect Theory', year: 1992 }],
  supersededById: null,
  truthStatus: 'unverified',
  truthNote: null,
  counterSources: null,
  ...over,
});

beforeEach(() => {
  mockList.mockReset();
  mockDecide.mockReset().mockResolvedValue({ data: { updated: 1 } });
  mockMarkTruth.mockReset().mockResolvedValue({ data: { updated: 1 } });
  mockPromote.mockReset().mockResolvedValue({ data: { promoted: true } });
  mockRevalidate.mockReset().mockResolvedValue({ data: { revalidated: 1, status: 'approved' } });
  mockNavigate.mockReset();
  mockOpenURL.mockClear();
  mockListGroups.mockReset().mockResolvedValue({ data: [] });
});

// 组件忽略 props(用 useNavigation),测试里当无 props 组件渲染,避免 never 展开
const Screen = BrainEpisodicMemoryScreen as unknown as () => React.ReactElement;

it('finding 渲染研究结论徽标 + 来源链接;已批准筛选下', async () => {
  // pending(默认)空,切到已批准
  mockList.mockImplementation(async (status: string) =>
    status === 'approved' ? { data: { items: [finding()] } } : { data: { items: [] } },
  );
  const { getByText, queryByText } = render(<Screen />);
  await waitFor(() => expect(queryByText('没有待审核的记忆')).toBeTruthy());
  fireEvent.press(getByText('已批准'));
  await waitFor(() => expect(getByText('研究结论')).toBeTruthy());
  expect(getByText(/Prospect Theory/)).toBeTruthy();
  expect(getByText('损失厌恶系数约 2.25')).toBeTruthy();
});

it('refuted finding 显示【已证伪】徽标 + 反证链接', async () => {
  mockList.mockImplementation(async (status: string) =>
    status === 'approved'
      ? {
          data: {
            items: [
              finding({
                truthStatus: 'refuted',
                truthNote: '系统综述未能复现',
                counterSources: [{ url: 'https://doi.org/10.1/pashler' }],
              }),
            ],
          },
        }
      : { data: { items: [] } },
  );
  const { getByText } = render(<Screen />);
  await waitFor(() => getByText('已批准'));
  fireEvent.press(getByText('已批准'));
  await waitFor(() => expect(getByText('已证伪')).toBeTruthy());
  expect(getByText(/系统综述未能复现/)).toBeTruthy();
  expect(getByText(/反证/)).toBeTruthy();
});

it('点来源链接打开 URL;点来源任务深链跳 BrainAgentTaskDetail', async () => {
  mockList.mockImplementation(async (status: string) =>
    status === 'approved' ? { data: { items: [finding()] } } : { data: { items: [] } },
  );
  const { getByText } = render(<Screen />);
  await waitFor(() => getByText('已批准'));
  fireEvent.press(getByText('已批准'));
  await waitFor(() => getByText(/Prospect Theory/));
  fireEvent.press(getByText(/Prospect Theory/));
  expect(mockOpenURL).toHaveBeenCalledWith('https://doi.org/10.1/tk');
  fireEvent.press(getByText('查看来源任务 →'));
  expect(mockNavigate).toHaveBeenCalledWith('BrainAgentTaskDetail', { runId: 'run-9' });
});

it('已标错筛选:rejected 条目可「恢复」(decide approve)', async () => {
  mockList.mockImplementation(async (status: string) =>
    status === 'rejected'
      ? { data: { items: [finding({ status: 'rejected' })] } }
      : { data: { items: [] } },
  );
  const { getByText } = render(<Screen />);
  await waitFor(() => getByText('已标错'));
  fireEvent.press(getByText('已标错'));
  await waitFor(() => getByText('恢复'));
  fireEvent.press(getByText('恢复'));
  expect(mockDecide).toHaveBeenCalledWith(9, 'approve', undefined);
});


// ── F1:时效轴恢复 ──

it('F1 已标错+已失效:恢复先 revalidate;revalidate 回 status=approved 时不再补 decide', async () => {
  mockRevalidate.mockResolvedValue({ data: { revalidated: 1, status: 'approved' } });
  mockList.mockImplementation(async (status: string) =>
    status === 'rejected'
      ? { data: { items: [finding({ status: 'rejected', validUntil: '2026-06-01T00:00:00+00:00' })] } }
      : { data: { items: [] } },
  );
  const { getByText } = render(<Screen />);
  await waitFor(() => getByText('已标错'));
  fireEvent.press(getByText('已标错'));
  await waitFor(() => getByText('恢复'));
  fireEvent.press(getByText('恢复'));
  await waitFor(() => expect(mockRevalidate).toHaveBeenCalledWith(9, undefined));
  expect(mockDecide).not.toHaveBeenCalled(); // revalidate 已回 approved,不补 decide
});

it('F1 已标错+已失效:revalidate 回 status=rejected 时补 decide(approve)', async () => {
  mockRevalidate.mockResolvedValue({ data: { revalidated: 1, status: 'rejected' } });
  mockList.mockImplementation(async (status: string) =>
    status === 'rejected'
      ? { data: { items: [finding({ status: 'rejected', validUntil: '2026-06-01T00:00:00+00:00' })] } }
      : { data: { items: [] } },
  );
  const { getByText } = render(<Screen />);
  await waitFor(() => getByText('已标错'));
  fireEvent.press(getByText('已标错'));
  await waitFor(() => getByText('恢复'));
  fireEvent.press(getByText('恢复'));
  await waitFor(() => expect(mockDecide).toHaveBeenCalledWith(9, 'approve', undefined));
  expect(mockRevalidate).toHaveBeenCalledWith(9, undefined);
});

it('F1 已标错但未失效(validUntil=null):只 decide(approve),不调 revalidate', async () => {
  mockList.mockImplementation(async (status: string) =>
    status === 'rejected'
      ? { data: { items: [finding({ status: 'rejected', validUntil: null })] } }
      : { data: { items: [] } },
  );
  const { getByText } = render(<Screen />);
  await waitFor(() => getByText('已标错'));
  fireEvent.press(getByText('已标错'));
  await waitFor(() => getByText('恢复'));
  fireEvent.press(getByText('恢复'));
  await waitFor(() => expect(mockDecide).toHaveBeenCalledWith(9, 'approve', undefined));
  expect(mockRevalidate).not.toHaveBeenCalled();
});

it('F1 已批准但已失效:卡片显示【已失效】标', async () => {
  mockList.mockImplementation(async (status: string) =>
    status === 'approved'
      ? { data: { items: [finding({ validUntil: '2026-06-01T00:00:00+00:00' })] } }
      : { data: { items: [] } },
  );
  const { getByText } = render(<Screen />);
  await waitFor(() => getByText('已批准'));
  fireEvent.press(getByText('已批准'));
  await waitFor(() => expect(getByText('已失效')).toBeTruthy());
});

// ── F2:已升格记忆纠正路径 ──

it('F2 已升格(promotedAt)卡片仍可「标记错误」(decide reject)', async () => {
  mockList.mockImplementation(async (status: string) =>
    status === 'approved'
      ? { data: { items: [finding({ kind: 'fact', promotedAt: '2026-06-09T00:00:00+00:00' })] } }
      : { data: { items: [] } },
  );
  const { getByText } = render(<Screen />);
  await waitFor(() => getByText('已批准'));
  fireEvent.press(getByText('已批准'));
  await waitFor(() => getByText('已升格到核心记忆'));
  fireEvent.press(getByText('标记错误'));
  expect(mockDecide).toHaveBeenCalledWith(9, 'reject', undefined);
});

// ── F5:未知 truthStatus 当 unverified(不渲染徽标) ──

// ── U5:群池评审入口(后端 scope=group 已就绪,K8 deferred 收口) ──

it('U5 有群时显示「我的/群名」切换,切群后 list 带 scope=group', async () => {
  mockListGroups.mockResolvedValue({ data: [{ id: 'g1', name: '家人群' }] });
  mockList.mockResolvedValue({ data: { items: [] } });
  const { getByText } = render(<Screen />);
  await waitFor(() => getByText('家人群'));
  fireEvent.press(getByText('家人群'));
  await waitFor(() =>
    expect(mockList).toHaveBeenCalledWith('pending', { scope: 'group', groupId: 'g1' }),
  );
});

it('U5 群 scope:fact 不显示「升格到核心」,标记错误带 scope', async () => {
  mockListGroups.mockResolvedValue({ data: [{ id: 'g1', name: '家人群' }] });
  mockList.mockImplementation(async (status: string, scope?: unknown) =>
    scope && status === 'approved'
      ? { data: { items: [finding({ kind: 'fact' })] } }
      : { data: { items: [] } },
  );
  const { getByText, queryByText } = render(<Screen />);
  await waitFor(() => getByText('家人群'));
  fireEvent.press(getByText('家人群'));
  fireEvent.press(getByText('已批准'));
  await waitFor(() => getByText('标记错误'));
  expect(queryByText('升格到核心')).toBeNull();
  fireEvent.press(getByText('标记错误'));
  expect(mockDecide).toHaveBeenCalledWith(9, 'reject', { scope: 'group', groupId: 'g1' });
});

it('F5 未知 truthStatus 不渲染真伪徽标(当 unverified 处理)', async () => {
  mockList.mockImplementation(async (status: string) =>
    status === 'approved'
      ? { data: { items: [finding({ truthStatus: 'corroborated' as never })] } }
      : { data: { items: [] } },
  );
  const { getByText, queryByText } = render(<Screen />);
  await waitFor(() => getByText('已批准'));
  fireEvent.press(getByText('已批准'));
  await waitFor(() => getByText('研究结论'));
  expect(queryByText('有争议')).toBeNull();
  expect(queryByText('已证伪')).toBeNull();
});
