import type { UserPersonaSettings } from '@xzz/shared';

const mockGetPersona = jest.fn();
jest.mock('./api', () => ({
  api: { getPersona: (...a: unknown[]) => mockGetPersona(...a) },
}));

import {
  getPersonaState,
  invalidatePersona,
  loadPersona,
  resetPersonaStore,
  setPersonaCache,
  setPersonaAvatar,
  subscribePersona,
} from './personaStore';

const PERSONA: UserPersonaSettings = { identity: { assistantName: '旺财' } };
const PERSONA2: UserPersonaSettings = { identity: { assistantName: '二狗' } };

beforeEach(() => {
  mockGetPersona.mockReset();
  resetPersonaStore();
});

describe('personaStore', () => {
  it('并发 loadPersona 共享同一在途请求(去重),只发一次 GET', async () => {
    let resolveFn: (v: { data: UserPersonaSettings }) => void = () => {};
    mockGetPersona.mockReturnValue(
      new Promise((r) => {
        resolveFn = r;
      }),
    );

    const p1 = loadPersona();
    const p2 = loadPersona();
    expect(mockGetPersona).toHaveBeenCalledTimes(1);

    resolveFn({ data: PERSONA });
    await expect(p1).resolves.toEqual(PERSONA);
    await expect(p2).resolves.toEqual(PERSONA);
  });

  it('解析后命中缓存,再次 loadPersona 不重发 GET', async () => {
    mockGetPersona.mockResolvedValue({ data: PERSONA });
    await loadPersona();
    await loadPersona();
    expect(mockGetPersona).toHaveBeenCalledTimes(1);
    expect(getPersonaState().persona).toEqual(PERSONA);
  });

  it('force=true 跳过缓存强拉', async () => {
    mockGetPersona.mockResolvedValueOnce({ data: PERSONA });
    mockGetPersona.mockResolvedValueOnce({ data: PERSONA2 });
    await loadPersona();
    const fresh = await loadPersona({ force: true });
    expect(mockGetPersona).toHaveBeenCalledTimes(2);
    expect(fresh).toEqual(PERSONA2);
    expect(getPersonaState().persona).toEqual(PERSONA2);
  });

  it('invalidatePersona 失效缓存,下次 loadPersona 重新拉取', async () => {
    mockGetPersona.mockResolvedValue({ data: PERSONA });
    await loadPersona();
    invalidatePersona();
    expect(getPersonaState().persona).toBeNull();
    await loadPersona();
    expect(mockGetPersona).toHaveBeenCalledTimes(2);
  });

  it('setPersonaCache 直接写入缓存(免再发 GET),后续读命中', async () => {
    setPersonaCache(PERSONA);
    expect(getPersonaState().persona).toEqual(PERSONA);
    await loadPersona();
    expect(mockGetPersona).not.toHaveBeenCalled();
  });

  it('订阅者在 persona / avatar 变化时被通知', async () => {
    mockGetPersona.mockResolvedValue({ data: PERSONA });
    const listener = jest.fn();
    const unsub = subscribePersona(listener);

    await loadPersona();
    expect(listener).toHaveBeenCalled();

    listener.mockClear();
    setPersonaAvatar(null);
    setPersonaCache(PERSONA2);
    expect(listener).toHaveBeenCalledTimes(2);

    unsub();
    listener.mockClear();
    setPersonaCache(PERSONA);
    expect(listener).not.toHaveBeenCalled();
  });

  it('getPersonaState 内容不变则返回同一引用(useSyncExternalStore 安全)', async () => {
    const before = getPersonaState();
    expect(getPersonaState()).toBe(before);
    setPersonaCache(PERSONA);
    expect(getPersonaState()).not.toBe(before);
  });

  it('请求失败时清空在途、缓存保持 null,下次 loadPersona 可重试', async () => {
    mockGetPersona.mockRejectedValueOnce(new Error('boom'));
    await expect(loadPersona()).rejects.toThrow('boom');
    expect(getPersonaState().persona).toBeNull();

    mockGetPersona.mockResolvedValueOnce({ data: PERSONA });
    await expect(loadPersona()).resolves.toEqual(PERSONA);
    expect(mockGetPersona).toHaveBeenCalledTimes(2);
  });
});
