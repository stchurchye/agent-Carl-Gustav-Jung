import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WeChatChatHeader } from '../components/WeChatChatHeader';
import { WeChatGroupedSection } from '../components/wechat/WeChatGroupedSection';
import { WeChatListCell } from '../components/wechat/WeChatListCell';
import { appAlert } from '../lib/appAlert';
import { getDashScopeApiKey } from '../lib/dashscopeKey';
import {
  getStoredVoiceId,
  getTtsEngineName,
  listVoicesForDialect,
  setStoredVoiceId,
  speakText,
  ttsVoiceOptionId,
  ttsVoiceOptionLabel,
  type TtsVoiceOption,
} from '../lib/tts';
import { wechatChatStyles } from '../theme/wechatChat';
import { colors, typography } from '../theme/colors';
import { zh } from '../locales/zh-CN';

const TTS_DIALECT = 'mandarin' as const;

export function SettingsVoiceScreen() {
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [voices, setVoices] = useState<TtsVoiceOption[]>([]);
  const [selectedVoiceId, setSelectedVoiceId] = useState<string | null>(null);
  const [ttsEngineName, setTtsEngineName] = useState('');
  const [usingQwenTts, setUsingQwenTts] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [list, stored, engineName, dash] = await Promise.all([
        listVoicesForDialect(TTS_DIALECT),
        getStoredVoiceId(TTS_DIALECT),
        getTtsEngineName(TTS_DIALECT),
        getDashScopeApiKey(),
      ]);
      setVoices(list);
      setSelectedVoiceId(stored);
      setTtsEngineName(engineName);
      setUsingQwenTts(Boolean(dash));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const selectVoice = async (voiceId: string | null) => {
    await setStoredVoiceId(TTS_DIALECT, voiceId);
    setSelectedVoiceId(voiceId);
    appAlert('已保存', zh.me.voiceSaved);
  };

  const previewVoice = (voiceId: string | null) => {
    void speakText(zh.me.voicePreviewText, undefined, {
      voiceId: voiceId ?? undefined,
      dialect: TTS_DIALECT,
    }).catch(() => {});
  };

  const engineLine =
    ttsEngineName || (usingQwenTts ? zh.me.voiceEngineQwen : zh.me.voiceEngineSystem);

  return (
    <View style={wechatChatStyles.page}>
      <WeChatChatHeader title={zh.me.voiceTitle} showBack />
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: Math.max(insets.bottom, 16) + 12 },
        ]}
      >
        {loading ? (
          <ActivityIndicator style={styles.loader} color={colors.primary} />
        ) : (
          <WeChatGroupedSection footer={`${engineLine}\n${usingQwenTts ? zh.me.voiceHintQwen : zh.me.voiceHintSystem}`}>
            <WeChatListCell
              label={zh.me.voiceDefault}
              value={selectedVoiceId === null ? zh.me.selected : undefined}
              onPress={() => void selectVoice(null)}
              showSeparator={voices.length > 0}
            />
            {voices.map((v, idx) => {
              const id = ttsVoiceOptionId(v);
              return (
                <WeChatListCell
                  key={id}
                  label={ttsVoiceOptionLabel(v)}
                  value={selectedVoiceId === id ? zh.me.selected : undefined}
                  onPress={() => void selectVoice(id)}
                  showSeparator={idx < voices.length - 1}
                  right={
                    <Pressable onPress={() => void previewVoice(id)} hitSlop={8}>
                      <Text style={styles.previewLink}>{zh.me.voicePreview}</Text>
                    </Pressable>
                  }
                  showChevron={false}
                />
              );
            })}
          </WeChatGroupedSection>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingTop: 12 },
  loader: { marginTop: 48 },
  previewLink: {
    color: colors.primary,
    fontSize: typography.caption,
  },
});
