import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { UserAvatarHistoryEntry } from '@xzz/shared';
import { WeChatChatHeader } from '../components/WeChatChatHeader';
import { ChatAvatar } from '../components/ChatAvatar';
import { useAuth } from '../components/AuthGate';
import { api } from '../lib/api';
import { apiErrorText } from '../lib/apiError';
import { appAlert } from '../lib/appAlert';
import { pickProfileAvatar } from '../lib/profileAvatar';
import type { GroupStackParamList } from '../navigation/types';
import { colors } from '../theme/colors';
import { wechatChatStyles } from '../theme/wechatChat';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { zh } from '../locales/zh-CN';

type Props = NativeStackScreenProps<GroupStackParamList, 'SettingsProfileAvatar'>;

export function SettingsProfileAvatarScreen(_props: Props) {
  const insets = useSafeAreaInsets();
  const { user, applyAuthUser } = useAuth();
  const [uploading, setUploading] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [avatarHistory, setAvatarHistory] = useState<UserAvatarHistoryEntry[]>([]);

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const res = await api.getProfileHistory();
      setAvatarHistory(res.data.avatars);
    } catch {
      setAvatarHistory([]);
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadHistory();
    }, [loadHistory]),
  );

  async function changeAvatar() {
    const picked = await pickProfileAvatar();
    if (picked === 'denied') {
      appAlert('提示', zh.me.profilePickDenied);
      return;
    }
    if (!picked) return;
    setUploading(true);
    try {
      const res = await api.uploadProfileAvatar(picked);
      await applyAuthUser(res.data.user, res.data.tokens.accessToken);
      void loadHistory();
    } catch (e) {
      appAlert(zh.me.profileAvatarFailed, apiErrorText(e).message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <View style={wechatChatStyles.page}>
      <WeChatChatHeader title={zh.me.profileAvatar} showBack />
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: Math.max(insets.bottom, 24) },
        ]}
      >
        <Pressable
          style={styles.avatarTap}
          onPress={() => void changeAvatar()}
          disabled={uploading}
          accessibilityRole="button"
          accessibilityLabel={zh.me.profileChangeAvatar}
        >
          {uploading ? (
            <ActivityIndicator color={colors.primary} style={styles.avatarLoader} />
          ) : (
            <ChatAvatar
              name={user?.displayName ?? '?'}
              seed={user?.id ?? 'me'}
              size={96}
              imageUri={user?.avatarDisplayUrl}
            />
          )}
        </Pressable>

        {loadingHistory ? (
          <ActivityIndicator style={styles.historyLoader} color={colors.primary} />
        ) : avatarHistory.length > 0 ? (
          <View style={styles.historyGrid}>
            {avatarHistory.map((entry) => (
              <View key={entry.id} style={styles.historyItem}>
                <Image source={{ uri: entry.displayUrl }} style={styles.historyThumb} />
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingTop: 32,
    alignItems: 'center',
  },
  avatarTap: {
    paddingVertical: 16,
    paddingHorizontal: 24,
  },
  avatarLoader: {
    width: 96,
    height: 96,
  },
  historyLoader: {
    marginTop: 32,
  },
  historyGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 40,
    width: '100%',
  },
  historyItem: {
    width: 64,
    height: 64,
  },
  historyThumb: {
    width: 64,
    height: 64,
    borderRadius: 4,
  },
});
