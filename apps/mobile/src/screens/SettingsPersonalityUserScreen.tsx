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
  PERSONA_TIMEZONE_MAX,
  PERSONA_USER_BIO_MAX,
  PERSONA_USER_HABITS_MAX,
  PERSONA_USER_NAME_MAX,
} from '@xzz/shared';
import { WeChatChatHeader } from '../components/WeChatChatHeader';
import { AppTextInput } from '../components/AppTextInput';
import { WeChatGroupedSection } from '../components/wechat/WeChatGroupedSection';
import { api } from '../lib/api';
import { apiErrorText } from '../lib/apiError';
import { appAlert } from '../lib/appAlert';
import type { GroupStackParamList } from '../navigation/types';
import { colors, typography } from '../theme/colors';
import { wechatChatStyles } from '../theme/wechatChat';
import { zh } from '../locales/zh-CN';

type Props = NativeStackScreenProps<GroupStackParamList, 'SettingsPersonalityUser'>;

export function SettingsPersonalityUserScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const [preferredName, setPreferredName] = useState('');
  const [timezone, setTimezone] = useState('');
  const [bio, setBio] = useState('');
  const [habits, setHabits] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.getPersona();
      const user = res.data.user;
      setPreferredName(user?.preferredName ?? '');
      setTimezone(user?.timezone ?? '');
      setBio(user?.bio ?? '');
      setHabits(user?.habits ?? '');
    } catch {
      setPreferredName('');
      setTimezone('');
      setBio('');
      setHabits('');
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
      await api.patchPersona({
        user: {
          preferredName: preferredName.trim() || undefined,
          timezone: timezone.trim() || undefined,
          bio: bio.trim() || undefined,
          habits: habits.trim() || undefined,
        },
      });
      navigation.goBack();
    } catch (e) {
      appAlert(zh.me.personalityFailed, apiErrorText(e).message);
    } finally {
      setSaving(false);
    }
  }, [bio, habits, navigation, preferredName, timezone]);

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
        title={zh.me.personalityUserTitle}
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
              <Text style={styles.label}>{zh.me.personalityPreferredName}</Text>
              <AppTextInput
                value={preferredName}
                onChangeText={setPreferredName}
                placeholder={zh.me.personalityPreferredNamePh}
                maxLength={PERSONA_USER_NAME_MAX + 4}
              />
            </View>
            <View style={[styles.field, styles.fieldBorder]}>
              <Text style={styles.label}>{zh.me.personalityTimezone}</Text>
              <AppTextInput
                value={timezone}
                onChangeText={setTimezone}
                placeholder={zh.me.personalityTimezonePh}
                maxLength={PERSONA_TIMEZONE_MAX + 8}
                autoCapitalize="none"
              />
            </View>
            <View style={[styles.field, styles.fieldBorder]}>
              <Text style={styles.label}>{zh.me.personalityBio}</Text>
              <AppTextInput
                value={bio}
                onChangeText={setBio}
                placeholder={zh.me.personalityBioPh}
                multiline
                maxLength={PERSONA_USER_BIO_MAX + 16}
              />
            </View>
            <View style={[styles.field, styles.fieldBorder]}>
              <Text style={styles.label}>{zh.me.personalityHabits}</Text>
              <AppTextInput
                value={habits}
                onChangeText={setHabits}
                placeholder={zh.me.personalityHabitsPh}
                multiline
                maxLength={PERSONA_USER_HABITS_MAX + 16}
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
