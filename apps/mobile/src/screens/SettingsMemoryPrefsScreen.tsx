import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  MEMORY_PROJECT_NOTE_CHAR_LIMIT,
  MEMORY_USER_PROFILE_CHAR_LIMIT,
} from '@xzz/shared';
import { WeChatChatHeader } from '../components/WeChatChatHeader';
import { api } from '../lib/api';
import { apiErrorText } from '../lib/apiError';
import { appAlert } from '../lib/appAlert';
import type { GroupStackParamList } from '../navigation/types';
import { colors, typography } from '../theme/colors';
import { wechatChatStyles } from '../theme/wechatChat';
import { zh } from '../locales/zh-CN';

type Props = NativeStackScreenProps<GroupStackParamList, 'SettingsMemoryPrefs'>;

export function SettingsMemoryPrefsScreen(_props: Props) {
  const insets = useSafeAreaInsets();
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getMemorySettings();
      setEnabled(res.data.autoExtractEnabled);
    } catch {
      setEnabled(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const onToggle = (value: boolean) => {
    setEnabled(value);
    setSaving(true);
    void api
      .patchMemorySettings({ autoExtractEnabled: value })
      .catch((e) => {
        appAlert('保存失败', apiErrorText(e).message);
        void load();
      })
      .finally(() => setSaving(false));
  };

  return (
    <View style={wechatChatStyles.page}>
      <WeChatChatHeader title={zh.me.memoryPrefsTitle} showBack />
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: Math.max(insets.bottom, 16) + 12 },
        ]}
      >
        {loading ? (
          <ActivityIndicator color={colors.primary} style={styles.loader} />
        ) : (
          <>
            <View style={styles.row}>
              <View style={styles.textCol}>
                <Text style={styles.label}>{zh.me.memoryAutoExtract}</Text>
                <Text style={styles.hint}>{zh.me.memoryAutoExtractHint}</Text>
              </View>
              <Switch
                value={enabled}
                onValueChange={onToggle}
                disabled={saving}
              />
            </View>
            <Text style={styles.limits}>
              {zh.me.memoryLimitsHint}（{MEMORY_USER_PROFILE_CHAR_LIMIT} /{' '}
              {MEMORY_PROJECT_NOTE_CHAR_LIMIT}）
            </Text>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingTop: 12, paddingHorizontal: 16 },
  loader: { marginVertical: 32 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    padding: 16,
    borderRadius: 8,
    gap: 12,
  },
  textCol: { flex: 1 },
  label: { fontSize: typography.body, fontWeight: '600', color: colors.text },
  hint: {
    marginTop: 6,
    fontSize: typography.caption,
    color: colors.textMuted,
    lineHeight: 20,
  },
  limits: {
    marginTop: 16,
    fontSize: typography.caption,
    color: colors.textMuted,
    lineHeight: 20,
  },
});
