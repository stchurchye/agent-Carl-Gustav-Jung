import { render, fireEvent } from '@testing-library/react-native';
import type { DiaryEntry } from '@xzz/shared';

const mockGenerate = jest.fn();
const mockRefine = jest.fn();
const mockConfirm = jest.fn();
let mockHookState: {
  entry: DiaryEntry | null;
  loading: boolean;
  busy: boolean;
  error: string | null;
  generate: () => void;
  refine: (s: string) => void;
  confirm: () => void;
};

jest.mock('../features/diary/useDiaryEntry', () => ({ useDiaryEntry: () => mockHookState }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: jest.fn(), navigate: jest.fn() }),
}));

import { DiaryScreen } from './DiaryScreen';
import { zh } from '../locales/zh-CN';

function draftEntry(over: Partial<DiaryEntry> = {}): DiaryEntry {
  return {
    id: 'd', scope: 'self', scopeId: '', dayKey: '2026-06-20', summary: '今天很好',
    status: 'draft', sourceCount: 1, createdAt: '', updatedAt: '', ...over,
  };
}

function mount(params: Record<string, unknown>) {
  const route = { key: 'k', name: 'Diary', params } as never;
  const navigation = { goBack: jest.fn(), navigate: jest.fn() } as never;
  return render(<DiaryScreen route={route} navigation={navigation} />);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockHookState = {
    entry: null, loading: false, busy: false, error: null,
    generate: mockGenerate, refine: mockRefine, confirm: mockConfirm,
  };
});

it('无篇:显示生成按钮,点击触发 generate', () => {
  const { getByTestId, getByText } = mount({ scope: 'self', scopeId: '' });
  expect(getByText(zh.diary.empty)).toBeTruthy();
  fireEvent.press(getByTestId('diary-generate'));
  expect(mockGenerate).toHaveBeenCalled();
});

it('有 draft 篇:显示正文 + 确认按钮,确认触发 confirm', () => {
  mockHookState.entry = draftEntry();
  const { getByTestId, getByText } = mount({ scope: 'self', scopeId: '' });
  expect(getByText('今天很好')).toBeTruthy();
  fireEvent.press(getByTestId('diary-confirm'));
  expect(mockConfirm).toHaveBeenCalled();
});

it('矫正:输入意见 + 点改 → refine(意见)', () => {
  mockHookState.entry = draftEntry();
  const { getByTestId } = mount({ scope: 'self', scopeId: '' });
  fireEvent.changeText(getByTestId('diary-refine-input'), '写温暖点');
  fireEvent.press(getByTestId('diary-refine'));
  expect(mockRefine).toHaveBeenCalledWith('写温暖点');
});

it('已 distilled:不显示确认按钮(已收进记忆)', () => {
  mockHookState.entry = draftEntry({ status: 'distilled' });
  const { queryByTestId } = mount({ scope: 'self', scopeId: '' });
  expect(queryByTestId('diary-confirm')).toBeNull();
});

it('群篇:标题带群名', () => {
  mockHookState.entry = draftEntry({ scope: 'group', scopeId: 'g1' });
  const { getByText } = mount({ scope: 'group', scopeId: 'g1', scopeName: '读书会' });
  expect(getByText(zh.diary.groupTitle('读书会'))).toBeTruthy();
});
