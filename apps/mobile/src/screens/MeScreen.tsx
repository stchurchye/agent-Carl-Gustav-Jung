import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { personaAssistantDisplayName } from '@xzz/shared';
import { WeChatChatHeader } from '../components/WeChatChatHeader';
import { ChatAvatar } from '../components/ChatAvatar';
import { PixelListCell } from '../components/pixel/PixelListCell';
import { wechatChatStyles } from '../theme/wechatChat';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  filterVisibleDocuments,
  isDocumentHidden,
} from '../lib/documentVisibility';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../lib/api';
import {
  getStoredVoiceId,
  listVoicesForDialect,
  ttsVoiceOptionId,
  ttsVoiceOptionLabel,
} from '../lib/tts';
import { TabletFrame } from '../components/TabletFrame';
import { useLayout } from '../theme/layout';
import { zh } from '../locales/zh-CN';
import { useAuth } from '../components/AuthGate';
import type { GroupStackParamList } from '../navigation/types';

const TTS_DIALECT = 'mandarin' as const;

type Props = NativeStackScreenProps<GroupStackParamList, 'Settings'>;

/** 设置页:一行一卡的像素风列表(Bow Wow Know 改版) */
export function MeScreen({ navigation }: Props) {
  const { user, logout } = useAuth();
  const insets = useSafeAreaInsets();
  const { isTablet, width } = useLayout();
  const mePadX = isTablet ? 20 : 12;
  const [voiceSummary, setVoiceSummary] = useState<string>(zh.me.voiceDefault);
  const [visibleDocCount, setVisibleDocCount] = useState(0);
  const [hiddenDocCount, setHiddenDocCount] = useState(0);
  const [dogName, setDogName] = useState<string>('');
  const [preferredName, setPreferredName] = useState<string>('');

  const loadSummaries = useCallback(async () => {
    const [storedVoiceId, voices, docsRes, personaRes] = await Promise.all([
      getStoredVoiceId(TTS_DIALECT),
      listVoicesForDialect(TTS_DIALECT),
      api.listDocuments().catch(() => ({ data: [] as Awaited<ReturnType<typeof api.listDocuments>>['data'] })),
      api.getPersona().catch(() => null),
    ]);

    if (storedVoiceId === null) {
      setVoiceSummary(zh.me.voiceDefault);
    } else {
      const match = voices.find((v) => ttsVoiceOptionId(v) === storedVoiceId);
      setVoiceSummary(match ? ttsVoiceOptionLabel(match) : zh.me.voiceDefault);
    }

    const docs = docsRes.data;
    setVisibleDocCount(filterVisibleDocuments(docs).length);
    setHiddenDocCount(docs.filter((d) => isDocumentHidden(d)).length);

    if (personaRes) {
      setDogName(personaAssistantDisplayName(personaRes.data));
      setPreferredName(personaRes.data.user?.preferredName ?? '');
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadSummaries();
    }, [loadSummaries]),
  );

  return (
    <View style={wechatChatStyles.page}>
      <WeChatChatHeader title={zh.me.settings} showBack />
      <ScrollView
        style={styles.container}
        contentContainerStyle={[
          styles.content,
          isTablet && styles.contentTablet,
          {
            paddingTop: 12,
            paddingBottom: Math.max(insets.bottom, 16),
            paddingHorizontal: mePadX,
            maxWidth: width,
            width: '100%',
            alignSelf: 'center',
          },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <TabletFrame variant="settings" scrollChild>
          {user ? (
            <Pressable
              style={styles.profileCard}
              onPress={() => navigation.navigate('SettingsProfile')}
            >
              <ChatAvatar
                name={user.displayName}
                seed={user.id}
                size={56}
                imageUri={user.avatarDisplayUrl}
              />
              <View style={styles.profileText}>
                <Text style={styles.profileName}>{user.displayName}</Text>
              </View>
              <Text style={styles.profileChevron}>›</Text>
            </Pressable>
          ) : null}

          <PixelListCell
            label={zh.me.myName}
            value={user?.displayName}
            onPress={() => navigation.navigate('SettingsProfileName')}
          />
          <PixelListCell
            label={zh.me.myDog}
            value={user?.pixelAvatar ? zh.me.myDogAdopted : zh.me.myDogNotAdopted}
            onPress={() => navigation.navigate('SettingsMyDog')}
          />
          <PixelListCell
            label={zh.me.personalityAssistantName}
            value={dogName}
            onPress={() => navigation.navigate('SettingsPersonalityIdentity')}
          />
          <PixelListCell
            label={zh.me.callMe}
            value={preferredName || zh.me.notSet}
            onPress={() => navigation.navigate('SettingsPersonalityUser')}
          />
          <PixelListCell
            label={zh.me.voiceTitle}
            value={voiceSummary}
            onPress={() => navigation.navigate('SettingsVoice')}
          />
          <PixelListCell
            label={zh.me.exportTitle}
            onPress={() => navigation.navigate('SettingsTopicExport')}
          />
          <PixelListCell
            label={zh.me.allDocs}
            value={zh.me.docsCount(visibleDocCount)}
            onPress={() => navigation.navigate('SettingsDocuments', { scope: 'visible' })}
          />
          {hiddenDocCount > 0 ? (
            <PixelListCell
              label={zh.me.hiddenDocsTitle}
              value={zh.me.docsCount(hiddenDocCount)}
              onPress={() => navigation.navigate('SettingsDocuments', { scope: 'hidden' })}
            />
          ) : null}
          <PixelListCell
            label={zh.me.clientLogTitle}
            onPress={() => navigation.navigate('SettingsClientLogs')}
          />
          <PixelListCell
            label={`退出登录${user ? `（${user.displayName}）` : ''}`}
            destructive
            onPress={() => void logout()}
          />
        </TabletFrame>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { flexGrow: 1, paddingBottom: 40 },
  contentTablet: { paddingBottom: 48 },
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFDF7',
    borderWidth: 2,
    borderColor: '#3D3229',
    borderRadius: 4,
    marginBottom: 12,
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 14,
  },
  profileText: { flex: 1 },
  profileName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#111',
  },
  profileChevron: {
    fontSize: 22,
    color: '#c8c8c8',
    fontWeight: '300',
  },
});
