import { useCallback, useState } from 'react';
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
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  PROFILE_DISPLAY_NAME_MAX,
  validateProfileDisplayName,
} from '@xzz/shared';
import type { UserDisplayNameHistoryEntry } from '@xzz/shared';
import { WeChatChatHeader } from '../components/WeChatChatHeader';
import { AppTextInput } from '../components/AppTextInput';
import { WeChatGroupedSection } from '../components/wechat/WeChatGroupedSection';
import { useAuth } from '../components/AuthGate';
import { api } from '../lib/api';
import { apiErrorText } from '../lib/apiError';
import { appAlert } from '../lib/appAlert';
import type { GroupStackParamList } from '../navigation/types';
import { colors, typography } from '../theme/colors';
import { wechatChatStyles } from '../theme/wechatChat';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { zh } from '../locales/zh-CN';

type Props = NativeStackScreenProps<GroupStackParamList, 'SettingsProfileName'>;

export function SettingsProfileNameScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { user, applyAuthUser } = useAuth();
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [saving, setSaving] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [nameHistory, setNameHistory] = useState<UserDisplayNameHistoryEntry[]>([]);

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const res = await api.getProfileHistory();
      setNameHistory(res.data.displayNames);
    } catch {
      setNameHistory([]);
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      setDisplayName(user?.displayName ?? '');
      void loadHistory();
    }, [user?.displayName, loadHistory]),
  );

  const saveName = useCallback(async () => {
    const check = validateProfileDisplayName(displayName);
    if (!check.ok) {
      appAlert(
        '提示',
        check.error === 'empty' ? zh.me.profileNameEmpty : zh.me.profileNameTooLong,
      );
      return;
    }
    if (check.value === user?.displayName) {
      navigation.goBack();
      return;
    }
    setSaving(true);
    try {
      const res = await api.patchProfile(check.value);
      await applyAuthUser(res.data.user, res.data.tokens.accessToken);
      navigation.goBack();
    } catch (e) {
      appAlert(zh.me.profileFailed, apiErrorText(e).message);
    } finally {
      setSaving(false);
    }
  }, [applyAuthUser, displayName, navigation, user?.displayName]);

  const headerRight = (
    <Pressable
      onPress={() => void saveName()}
      disabled={saving}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={zh.me.profileSave}
    >
      {saving ? (
        <ActivityIndicator color={colors.primary} size="small" />
      ) : (
        <Text style={styles.headerSave}>{zh.me.profileSave}</Text>
      )}
    </Pressable>
  );

  return (
    <View style={wechatChatStyles.page}>
      <WeChatChatHeader
        title={zh.me.profileNameTitle}
        showBack
        right={headerRight}
      />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            { paddingBottom: Math.max(insets.bottom, 16) + 12 },
          ]}
          keyboardShouldPersistTaps="handled"
        >
          <WeChatGroupedSection>
            <View style={styles.nameField}>
              <AppTextInput
                value={displayName}
                onChangeText={setDisplayName}
                placeholder={zh.me.profileNamePlaceholder}
                maxLength={PROFILE_DISPLAY_NAME_MAX + 4}
                autoFocus
              />
            </View>
          </WeChatGroupedSection>

          {loadingHistory ? (
            <ActivityIndicator style={styles.historyLoader} color={colors.primary} />
          ) : nameHistory.length > 0 ? (
            <View style={styles.historyBlock}>
              {nameHistory.map((entry, idx) => (
                <View
                  key={entry.id}
                  style={[
                    styles.historyRow,
                    idx < nameHistory.length - 1 && styles.historyRowBorder,
                  ]}
                >
                  <Text style={styles.historyName}>{entry.displayName}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { paddingTop: 12 },
  headerSave: {
    fontSize: typography.body,
    color: colors.primary,
    fontWeight: '600',
    paddingHorizontal: 4,
  },
  nameField: {
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  historyLoader: { marginVertical: 24 },
  historyBlock: {
    marginTop: 24,
    marginHorizontal: 12,
    backgroundColor: '#fff',
    borderRadius: 8,
    overflow: 'hidden',
  },
  historyRow: {
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  historyRowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  historyName: {
    fontSize: typography.body,
    color: colors.text,
  },
});
