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
import { PERSONA_SOUL_FIELD_MAX } from '@xzz/shared';
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

type Props = NativeStackScreenProps<GroupStackParamList, 'SettingsPersonalitySoul'>;

export function SettingsPersonalitySoulScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const [tone, setTone] = useState('');
  const [boundaries, setBoundaries] = useState('');
  const [formatPrefs, setFormatPrefs] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const soul = (await loadPersona()).soul;
      setTone(soul?.tone ?? '');
      setBoundaries(soul?.boundaries ?? '');
      setFormatPrefs(soul?.formatPrefs ?? '');
    } catch {
      setTone('');
      setBoundaries('');
      setFormatPrefs('');
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
        soul: {
          tone: tone.trim() || undefined,
          boundaries: boundaries.trim() || undefined,
          formatPrefs: formatPrefs.trim() || undefined,
        },
      });
      setPersonaCache(res.data); // 编辑后返回需刷新:显式回写共享缓存,免再发 GET
      navigation.goBack();
    } catch (e) {
      appAlert(zh.me.personalityFailed, apiErrorText(e).message);
    } finally {
      setSaving(false);
    }
  }, [boundaries, formatPrefs, navigation, tone]);

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
        title={zh.me.personalitySoulTitle}
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
              <Text style={styles.label}>{zh.me.personalityTone}</Text>
              <AppTextInput
                value={tone}
                onChangeText={setTone}
                placeholder={zh.me.personalityTonePh}
                multiline
                maxLength={PERSONA_SOUL_FIELD_MAX + 16}
              />
            </View>
            <View style={[styles.field, styles.fieldBorder]}>
              <Text style={styles.label}>{zh.me.personalityBoundaries}</Text>
              <AppTextInput
                value={boundaries}
                onChangeText={setBoundaries}
                placeholder={zh.me.personalityBoundariesPh}
                multiline
                maxLength={PERSONA_SOUL_FIELD_MAX + 16}
              />
            </View>
            <View style={[styles.field, styles.fieldBorder]}>
              <Text style={styles.label}>{zh.me.personalityFormat}</Text>
              <AppTextInput
                value={formatPrefs}
                onChangeText={setFormatPrefs}
                placeholder={zh.me.personalityFormatPh}
                multiline
                maxLength={PERSONA_SOUL_FIELD_MAX + 16}
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
