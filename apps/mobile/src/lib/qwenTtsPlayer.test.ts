/**
 * Review 2026-06-11 [P2][mobile-screens-misc] qwenTtsPlayer.ts:102 / WritingScreen.tsx:293
 * - createAsync 的 Promise 在播放已失败(status error)后才 resolve 时,Sound 对象
 *   从未被 unload(currentSound 还没赋值/赋值后无人清理)→ 反复失败累积泄漏。
 * - 失败路径 playQwenSpeech 抛错后 currentSound 留存到下一次播放才被动清理。
 * 修后:迟到的 sound 立即 unload;playQwenSpeech finally 兜底 unload;
 * stopQwenPlayback 同步取得所有权(并发 stop 不双重 unload)。
 */

type StatusCb = (status: Record<string, unknown>) => void;

let lastStatusCb: StatusCb | null = null;
let resolveCreate: ((v: { sound: MockSound }) => void) | null = null;
let rejectCreate: ((e: unknown) => void) | null = null;

class MockSound {
  stopAsync = jest.fn().mockResolvedValue(undefined);
  unloadAsync = jest.fn().mockResolvedValue(undefined);
}

jest.mock('./api', () => ({
  api: {
    synthesizeSpeech: jest.fn().mockResolvedValue({ data: { audioBase64: 'QUJD' } }),
  },
}));
jest.mock('./clientLog', () => ({ clientLog: jest.fn() }));
jest.mock('./fsLegacy', () => ({
  writeBase64ToCacheFile: jest.fn().mockResolvedValue('file:///tmp/a.mp3'),
  deleteFileQuietly: jest.fn().mockResolvedValue(undefined),
}));

import { __setAvModuleForTests, playQwenSpeech, stopQwenPlayback } from './qwenTtsPlayer';

const avMock = {
  Audio: {
    setAudioModeAsync: jest.fn().mockResolvedValue(undefined),
    Sound: {
      createAsync: (_src: unknown, _opts: unknown, statusCb: StatusCb) => {
        lastStatusCb = statusCb;
        return new Promise((res, rej) => {
          resolveCreate = res as never;
          rejectCreate = rej;
        });
      },
    },
  },
} as never;

const flushOnce = () => new Promise((r) => setTimeout(r, 0));
const flush = async () => {
  for (let i = 0; i < 8; i++) await flushOnce();
};

beforeEach(() => {
  jest.clearAllMocks();
  __setAvModuleForTests(avMock);
  lastStatusCb = null;
  resolveCreate = null;
  rejectCreate = null;
});

afterEach(async () => {
  await stopQwenPlayback();
});

it('status 回调先报错、createAsync 后 resolve → 迟到的 Sound 立即被 unload', async () => {
  const p = playQwenSpeech('你好世界', 'voice', 'mandarin').catch((e) => e);
  await flush(); // 走到 createAsync,statusCb 已注册
  expect(lastStatusCb).toBeTruthy();

  // 播放失败(error status)→ playLocalUri reject
  lastStatusCb!({ isLoaded: true, error: 'decoder exploded' });
  const err = await p;
  expect(err).toBeInstanceOf(Error);

  // createAsync 这才 resolve 出 sound:必须被立即 unload,不能成为孤儿
  const sound = new MockSound();
  resolveCreate!({ sound });
  await flush();
  expect(sound.unloadAsync).toHaveBeenCalled();
});

it('正常赋值后失败 → playQwenSpeech 结束时 Sound 已被 unload(不留到下次播放)', async () => {
  const p = playQwenSpeech('你好世界', 'voice', 'mandarin').catch((e) => e);
  await flush();
  const sound = new MockSound();
  resolveCreate!({ sound });
  await flush(); // currentSound 已赋值

  lastStatusCb!({ isLoaded: true, error: 'mid-play failure' });
  const err = await p;
  expect(err).toBeInstanceOf(Error);
  await flush();
  expect(sound.unloadAsync).toHaveBeenCalled();
});

it('并发 stopQwenPlayback 只 unload 一次(同步取得所有权)', async () => {
  const p = playQwenSpeech('你好世界', 'voice', 'mandarin').catch((e) => e);
  await flush();
  const sound = new MockSound();
  resolveCreate!({ sound });
  await flush();

  await Promise.all([stopQwenPlayback(), stopQwenPlayback()]);
  expect(sound.unloadAsync).toHaveBeenCalledTimes(1);

  lastStatusCb!({ isLoaded: true, didJustFinish: true });
  await p;
  void rejectCreate;
});
