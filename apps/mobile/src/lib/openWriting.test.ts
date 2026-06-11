// Review 2026-06-11 [P1][mobile-screens-misc] openWriting.ts:72
// 解析 documentId 全失败(网络/接口错误)时,catch 曾用 documentId:'' 导航进
// WritingChapters → 屏幕 `if (!documentId) return` 永远 doc=null,后续操作全废。
// 修后:拿不到 documentId 就不导航,弹错误提示;已有 id 仅加载失败仍导航(屏内可重试)。

const mockNavigate = jest.fn();
const mockAppAlert = jest.fn();
const mockListDocuments = jest.fn();
const mockGetDocument = jest.fn();

jest.mock('./api', () => ({
  api: {
    listDocuments: (...a: unknown[]) => mockListDocuments(...a),
    getDocument: (...a: unknown[]) => mockGetDocument(...a),
    createDocument: jest.fn(),
  },
}));
jest.mock('./appAlert', () => ({ appAlert: (...a: unknown[]) => mockAppAlert(...a) }));
jest.mock('./writingCache', () => ({
  getCachedTabs: () => [],
  getCachedDocument: () => null,
  rememberDocument: jest.fn(),
}));

import { openWriting } from './openWriting';

const navigation = { navigate: mockNavigate } as never;

beforeEach(() => {
  jest.clearAllMocks();
});

it('documentId 解析失败 → 不导航、弹错误提示(不再传空串进屏幕)', async () => {
  mockListDocuments.mockRejectedValue(new Error('network down'));
  await openWriting(navigation);
  expect(mockNavigate).not.toHaveBeenCalled();
  expect(mockAppAlert).toHaveBeenCalled();
});

it('已有 documentId 但加载失败 → 仍导航(屏内可重试),id 不为空', async () => {
  mockGetDocument.mockRejectedValue(new Error('network down'));
  await openWriting(navigation, { documentId: 'doc-1' });
  expect(mockNavigate).toHaveBeenCalledWith(
    'WritingChapters',
    expect.objectContaining({ documentId: 'doc-1' }),
  );
});
