import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import { View } from 'react-native';
import type { User } from '@xzz/shared';
import { AuthScreen } from '../screens/AuthScreen';
import { BootSplash } from './BootSplash';
import {
  invalidatePersona,
  loadPersona,
  setPersonaAvatar,
} from '../lib/personaStore';
import { invalidateBrainSnapshot } from '../brain/useBrainSnapshot';
import {
  clearAuthSession,
  getAccessToken,
  getStoredUser,
  saveAuthSession,
} from '../lib/authSession';
import { setUnauthorizedHandler } from '../lib/authEvents';
import { API_BASE_URL } from '../lib/config';
import { appAlert } from '../lib/appAlert';
import { colors } from '../theme/colors';

type AuthContextValue = {
  user: User | null;
  logout: () => Promise<void>;
  applyAuthUser: (user: User, accessToken?: string) => Promise<void>;
};

const AuthContext = createContext<AuthContextValue>({
  user: null,
  logout: async () => {},
  applyAuthUser: async () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

type Props = {
  children: React.ReactNode;
};

// 启动加载页(BootSplash)最短展示时长。JS bundle 在热启动/生产内置时几乎瞬间就绪,
// 不强制一下品牌加载页会一闪而过;并行一个最小延时,让它至少露脸这么久。
const MIN_SPLASH_MS = 3600;

export function AuthGate({ children }: Props) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);

  const forceLogout = useCallback(async (reason?: string) => {
    await clearAuthSession();
    setUser(null);
    if (reason) {
      appAlert('需要重新登录', reason);
    }
  }, []);

  const applyAuthUser = useCallback(async (next: User, accessToken?: string) => {
    const token = accessToken ?? (await getAccessToken());
    if (token) {
      await saveAuthSession(token, next);
    }
    setUser(next);
  }, []);

  useEffect(() => {
    let mounted = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // 与真实初始化并行计时;最终 ready = max(初始化耗时, MIN_SPLASH_MS)。
    const minDelay = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, MIN_SPLASH_MS);
    });
    void (async () => {
      let nextUser: User | null = null;
      try {
        const token = await getAccessToken();
        const stored = await getStoredUser();
        if (token && stored) {
          try {
            const res = await fetch(`${API_BASE_URL}/api/auth/me`, {
              headers: { Authorization: `Bearer ${token}` },
            });
            const json = await res.json();
            if (json.ok) {
              nextUser = json.data as User;
            } else {
              if (res.status === 401) await clearAuthSession();
              nextUser = null;
            }
          } catch {
            // 网络失败 → 先用本地存的 user 顶上,不阻断进入
            nextUser = stored;
          }
        }
      } catch {
        // SecureStore/keychain 读失败也绝不能卡在启动页:当作未登录,放行到登录屏
        nextUser = null;
      }
      await minDelay;
      if (!mounted) return; // 卸载后不再 setState(避免泄漏/警告)
      setUser(nextUser);
      setReady(true);
    })();
    return () => {
      mounted = false;
      if (timer) clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      void forceLogout('登录状态已过期，请重新登录');
    });
    return () => setUnauthorizedHandler(null);
  }, [forceLogout]);

  // 水合全局 persona 来源,供 AuthGate 之外的 AppAlertDialog(经 usePersona)显示
  // 「会动的狗 + 狗名 + 对你的称呼」。狗形象即时取自 user.pixelAvatar(无则按 seed 兜底);
  // 狗名/称呼由共享缓存承载,这里 force 重拉以覆盖换用户 / 换形象的旧值。
  useEffect(() => {
    // 换用户/登出都先清掉上个用户的 BrainHub 缓存,防止跨用户串数据。
    invalidateBrainSnapshot();
    if (!user) {
      invalidatePersona();
      setPersonaAvatar(null);
      return;
    }
    setPersonaAvatar(user.pixelAvatar ?? null);
    void loadPersona({ force: true }).catch(() => {});
  }, [user]);

  if (!ready) {
    return <BootSplash />;
  }

  if (!user) {
    return <AuthScreen onAuthenticated={setUser} />;
  }

  const logout = async () => {
    await forceLogout();
  };

  return (
    <AuthContext.Provider value={{ user, logout, applyAuthUser }}>
      {children}
    </AuthContext.Provider>
  );
}
