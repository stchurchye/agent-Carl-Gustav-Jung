import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import { ActivityIndicator, View } from 'react-native';
import type { User } from '@xzz/shared';
import { presetDogForSeed } from '@xzz/shared';
import { AuthScreen } from '../screens/AuthScreen';
import {
  invalidatePersona,
  loadPersona,
  setPersonaDog,
} from '../lib/personaStore';
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

export function AuthGate({ children }: Props) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);

  const bootstrap = useCallback(async () => {
    const token = await getAccessToken();
    const stored = await getStoredUser();
    if (!token || !stored) {
      setUser(null);
      setReady(true);
      return;
    }
    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (json.ok) {
        setUser(json.data as User);
      } else {
        if (res.status === 401) {
          await clearAuthSession();
        }
        setUser(null);
      }
    } catch {
      setUser(stored);
    }
    setReady(true);
  }, []);

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
    bootstrap();
  }, [bootstrap]);

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
    if (!user) {
      invalidatePersona();
      setPersonaDog(null);
      return;
    }
    setPersonaDog(user.pixelAvatar?.dog ?? presetDogForSeed(user.id).dog);
    void loadPersona({ force: true }).catch(() => {});
  }, [user]);

  if (!ready) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
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
