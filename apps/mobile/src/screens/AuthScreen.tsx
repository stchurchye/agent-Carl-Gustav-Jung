import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { User } from '@xzz/shared';
import { PROFILE_DISPLAY_NAME_MAX } from '@xzz/shared';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppTextInput } from '../components/AppTextInput';
import { WeChatGroupedSection } from '../components/wechat/WeChatGroupedSection';
import { API_BASE_URL } from '../lib/config';
import { colors, typography } from '../theme/colors';
import { saveAuthSession } from '../lib/authSession';
import { wechat } from '../theme/wechat';

type Props = {
  onAuthenticated: (user: User) => void;
};

export function AuthScreen({ onAuthenticated }: Props) {
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    const u = username.trim().toLowerCase();
    if (!u || password.length < 6) {
      setError('用户名至少 2 个字符，密码至少 6 位');
      return;
    }
    setLoading(true);
    try {
      const path =
        mode === 'login' ? '/api/auth/login' : '/api/auth/register';
      const body =
        mode === 'login'
          ? { username: u, password }
          : {
              username: u,
              password,
              displayName: displayName.trim() || u,
            };
      const res = await fetch(`${API_BASE_URL}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!json.ok) {
        setError(json.message ?? '登录失败，请稍后再试');
        return;
      }
      const { user, tokens } = json.data as {
        user: User;
        tokens: { accessToken: string };
      };
      await saveAuthSession(tokens.accessToken, user);
      onAuthenticated(user);
    } catch {
      setError(`连不上服务器（${API_BASE_URL}），请先运行 npm run dev:api`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + 48, paddingBottom: insets.bottom + 24 },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.brand}>行动中止派</Text>
        <Text style={styles.subtitle}>
          {mode === 'login' ? '请先登录后再继续' : '注册新账号'}
        </Text>

        <WeChatGroupedSection>
          <View style={styles.field}>
            <AppTextInput
              placeholder="用户名"
              autoCapitalize="none"
              autoCorrect={false}
              value={username}
              onChangeText={setUsername}
            />
          </View>
          {mode === 'register' ? (
            <View style={[styles.field, styles.fieldBorder]}>
              <AppTextInput
                placeholder={`显示名称（可选，最多 ${PROFILE_DISPLAY_NAME_MAX} 字）`}
                value={displayName}
                onChangeText={setDisplayName}
                maxLength={PROFILE_DISPLAY_NAME_MAX + 4}
              />
            </View>
          ) : null}
          <View style={[styles.field, mode === 'register' && styles.fieldBorder]}>
            <AppTextInput
              placeholder="密码"
              secureTextEntry
              value={password}
              onChangeText={setPassword}
            />
          </View>
        </WeChatGroupedSection>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={submit}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color={colors.onPrimary} />
          ) : (
            <Text style={styles.buttonText}>
              {mode === 'login' ? '登录' : '注册'}
            </Text>
          )}
        </Pressable>

        <Pressable
          onPress={() => {
            setMode(mode === 'login' ? 'register' : 'login');
            setError(null);
          }}
        >
          <Text style={styles.switch}>
            {mode === 'login' ? '没有账号？去注册' : '已有账号？去登录'}
          </Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: wechat.pageBg,
  },
  scroll: {
    paddingHorizontal: 16,
  },
  brand: {
    fontSize: 22,
    fontWeight: '600',
    color: wechat.textPrimary,
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: typography.caption,
    color: wechat.textSecondary,
    textAlign: 'center',
    marginBottom: 24,
  },
  field: {
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  fieldBorder: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: wechat.separator,
  },
  button: {
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 20,
    minHeight: 48,
    justifyContent: 'center',
  },
  buttonDisabled: { opacity: 0.7 },
  buttonText: {
    color: colors.onPrimary,
    fontSize: typography.button,
    fontWeight: '600',
  },
  switch: {
    textAlign: 'center',
    marginTop: 20,
    color: colors.primary,
    fontSize: typography.caption,
  },
  error: {
    color: colors.error,
    fontSize: typography.caption,
    marginTop: 12,
    textAlign: 'center',
  },
});
