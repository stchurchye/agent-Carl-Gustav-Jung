import { useEffect, useSyncExternalStore } from 'react';
import type { PixelAvatarSettings, UserPersonaSettings } from '@xzz/shared';
import {
  getPersonaState,
  loadPersona,
  subscribePersona,
} from '../lib/personaStore';

/**
 * 订阅共享 persona 缓存的 hook:挂载时按需触发一次加载(命中缓存则不发请求),
 * 并在 persona / 狗形象变化时响应式重渲染。供组件复用同一来源,避免各自重复 GET。
 */
export function usePersona(): {
  persona: UserPersonaSettings | null;
  avatar: PixelAvatarSettings | null;
  /** 强制重拉(跳过缓存),用于「编辑后返回需刷新」之类场景。 */
  refresh: () => Promise<UserPersonaSettings>;
} {
  const state = useSyncExternalStore(
    subscribePersona,
    getPersonaState,
    getPersonaState,
  );

  useEffect(() => {
    void loadPersona().catch(() => {});
  }, []);

  return {
    persona: state.persona,
    avatar: state.avatar,
    refresh: () => loadPersona({ force: true }),
  };
}
