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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  PERSONA_ASSISTANT_NAME_MAX,
  PERSONA_EMOJI_MAX,
  PERSONA_STYLE_TAGS_MAX,
  type UserPersonaSettings,
} from '@xzz/shared';
import { WeChatChatHeader } from '../components/WeChatChatHeader';
import { AppTextInput } from '../components/AppTextInput';
import { WeChatGroupedSection } from '../components/wechat/WeChatGroupedSection';
import { api } from '../lib/api';
import { loadPersona, setPersonaCache } from '../lib/personaStore';
import { apiErrorText } from '../lib/apiError';
import { appAlert } from '../lib/appAlert';
import type { GroupStackParamList } from '../navigation/types';
import { colors, typography } from '../theme/colors';
import { wechatChatStyles } from '../theme/wechatChat';
import { zh } from '../locales/zh-CN';

type Props = NativeStackScreenProps<GroupStackParamList, 'SettingsPersonalityIdentity'>;

export function SettingsPersonalityIdentityScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const [assistantName, setAssistantName] = useState('');
  const [styleTags, setStyleTags] = useState('');
  const [emoji, setEmoji] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const id = (await loadPersona()).identity;
      setAssistantName(id?.assistantName ?? '');
      setStyleTags(id?.styleTags ?? '');
      setEmoji(id?.emoji ?? '');
    } catch {
      setAssistantName('');
      setStyleTags('');
      setEmoji('');
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const save = useCallback(async () => {
    setSaving(true);
    try {
      const res = await api.patchPersona({
        identity: {
          assistantName: assistantName.trim() || undefined,
          styleTags: styleTags.trim() || undefined,
          emoji: emoji.trim() || undefined,
        },
      });
      setPersonaCache(res.data); // 编辑后返回需刷新:显式回写共享缓存,免再发 GET
      navigation.goBack();
    } catch (e) {
      appAlert(zh.me.personalityFailed, apiErrorText(e).message);
    } finally {
      setSaving(false);
    }
  }, [assistantName, emoji, navigation, styleTags]);

  const headerRight = (
    <Pressable
      onPress={() => void save()}
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
        title={zh.me.personalityIdentityTitle}
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
            <View style={styles.field}>
              <Text style={styles.label}>{zh.me.personalityAssistantName}</Text>
              <AppTextInput
                value={assistantName}
                onChangeText={setAssistantName}
                placeholder={zh.me.personalityAssistantNamePh}
                maxLength={PERSONA_ASSISTANT_NAME_MAX + 4}
              />
            </View>
            <View style={[styles.field, styles.fieldBorder]}>
              <Text style={styles.label}>{zh.me.personalityStyleTags}</Text>
              <AppTextInput
                value={styleTags}
                onChangeText={setStyleTags}
                placeholder={zh.me.personalityStyleTagsPh}
                maxLength={PERSONA_STYLE_TAGS_MAX + 8}
              />
            </View>
            <View style={[styles.field, styles.fieldBorder]}>
              <Text style={styles.label}>{zh.me.personalityEmoji}</Text>
              <AppTextInput
                value={emoji}
                onChangeText={setEmoji}
                placeholder={zh.me.personalityEmojiPh}
                maxLength={PERSONA_EMOJI_MAX + 4}
              />
            </View>
          </WeChatGroupedSection>
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
  field: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  fieldBorder: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  label: {
    fontSize: typography.caption,
    color: colors.textMuted,
    marginBottom: 8,
  },
});
