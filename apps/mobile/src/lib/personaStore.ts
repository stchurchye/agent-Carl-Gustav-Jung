import type { DogConfig, UserPersonaSettings } from '@xzz/shared';
import { api } from './api';

/**
 * 全用户 persona 的单一来源:模块级缓存 + 在途请求去重 + 订阅。
 *
 * 背景:GET /api/users/me/persona 原本散落在十余处 screen 的 useFocusEffect 里各拉各的,
 * app 启动 / 切屏会并发多次同一请求。收敛到这里后:
 *  - 各 call site 改走 {@link loadPersona}(命中缓存即返回,并发自动共享在途请求);
 *  - 改资料 patch 成功后用返回值 {@link setPersonaCache} 显式刷新(免再发 GET);
 *  - 订阅机制让「AuthGate 之外」的 AppAlertDialog(经 usePersona)响应式拿到最新狗名/称呼。
 *
 * 注:persona(identity/soul/user)只由本端 patchPersona 改动,故缓存可信;
 * 跨端变更走显式 invalidate/refresh。狗形象由 AuthGate 在 user 变化时水合。
 */
type PersonaState = {
  /** 服务端 persona 缓存;null = 尚未加载。 */
  persona: UserPersonaSettings | null;
  /** 狗形象,由 AuthGate 在 user 变化时水合(供 AuthGate 之外的 AppAlertDialog 用)。 */
  dog: DogConfig | null;
};

let state: PersonaState = { persona: null, dog: null };
let inflight: Promise<UserPersonaSettings> | null = null;
// 代数:invalidate(登出/换用户)时自增;在途请求回来若代数已变就丢弃,
// 避免旧用户的 persona GET 迟到后把已清空的状态又写回(登出后短暂闪回旧狗名)。
let epoch = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function setState(patch: Partial<PersonaState>) {
  state = { ...state, ...patch };
  emit();
}

/** useSyncExternalStore 用:内容不变则返回同一引用。 */
export function getPersonaState(): PersonaState {
  return state;
}

export function subscribePersona(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * 拉取 persona:命中缓存即返回;并发自动去重(共享在途请求)。
 * force=true 跳过缓存强拉(换用户 / 换形象时用)。
 */
export function loadPersona(opts?: { force?: boolean }): Promise<UserPersonaSettings> {
  const cached = state.persona;
  if (!opts?.force && cached) return Promise.resolve(cached);
  if (inflight) return inflight;
  const startedEpoch = epoch;
  inflight = api
    .getPersona()
    .then((res) => {
      // 期间发生过 invalidate(登出/换用户)→ 丢弃这次结果,不写回旧数据
      if (epoch === startedEpoch) setState({ persona: res.data });
      return res.data;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** 直接写入最新 persona(patch 成功后用其返回值刷新缓存,免再发 GET)。 */
export function setPersonaCache(persona: UserPersonaSettings): void {
  setState({ persona });
}

/** 失效缓存,下次读取会重新拉取;自增代数让在途的旧请求结果作废。 */
export function invalidatePersona(): void {
  epoch += 1;
  inflight = null;
  setState({ persona: null });
}

/** 水合狗形象(AuthGate 在 user 变化时调用)。 */
export function setPersonaDog(dog: DogConfig | null): void {
  setState({ dog });
}

/** 仅供测试:复位模块级单例。 */
export function resetPersonaStore(): void {
  state = { persona: null, dog: null };
  inflight = null;
  listeners.clear();
}
