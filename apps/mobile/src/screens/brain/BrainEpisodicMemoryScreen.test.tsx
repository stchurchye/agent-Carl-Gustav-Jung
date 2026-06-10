import { Linking } from 'react-native';
import { render, waitFor, fireEvent } from '@testing-library/react-native';

const mockList = jest.fn();
const mockDecide = jest.fn();
const mockPromote = jest.fn();
const mockMarkTruth = jest.fn();
const mockNavigate = jest.fn();
const mockOpenURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined as never);

jest.mock('../../lib/api', () => ({
  api: {
    listAgentMemory: (...a: unknown[]) => mockList(...a),
    decideAgentMemory: (...a: unknown[]) => mockDecide(...a),
    promoteAgentMemory: (...a: unknown[]) => mockPromote(...a),
    markTruthAgentMemory: (...a: unknown[]) => mockMarkTruth(...a),
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
  mockNavigate.mockReset();
  mockOpenURL.mockClear();
});

const props = {} as never;

it('finding 渲染研究结论徽标 + 来源链接;已批准筛选下', async () => {
  // pending(默认)空,切到已批准
  mockList.mockImplementation(async (status: string) =>
    status === 'approved' ? { data: { items: [finding()] } } : { data: { items: [] } },
  );
  const { getByText, queryByText } = render(<BrainEpisodicMemoryScreen {...props} />);
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
  const { getByText } = render(<BrainEpisodicMemoryScreen {...props} />);
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
  const { getByText } = render(<BrainEpisodicMemoryScreen {...props} />);
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
  const { getByText } = render(<BrainEpisodicMemoryScreen {...props} />);
  await waitFor(() => getByText('已标错'));
  fireEvent.press(getByText('已标错'));
  await waitFor(() => getByText('恢复'));
  fireEvent.press(getByText('恢复'));
  expect(mockDecide).toHaveBeenCalledWith(9, 'approve');
});
