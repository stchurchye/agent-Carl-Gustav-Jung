import { useCallback, useState } from 'react';
import { ActivityIndicator, StyleSheet, Switch, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  MEMORY_PROJECT_NOTE_CHAR_LIMIT,
  MEMORY_USER_PROFILE_CHAR_LIMIT,
} from '@xzz/shared';
import { brainLogicHints } from '../../brain/logicHints';
import { BrainScreenShell } from '../../components/brain/BrainScreenShell';
import { api } from '../../lib/api';
import { apiErrorText } from '../../lib/apiError';
import { appAlert } from '../../lib/appAlert';
import { zh } from '../../locales/zh-CN';
import type { BrainStackParamList } from '../../navigation/types';
import { brainTokens } from '../../theme/brainTokens';

type Props = NativeStackScreenProps<BrainStackParamList, 'BrainMemoryPrefs'>;

export function BrainMemoryPrefsScreen(_props: Props) {
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
    <BrainScreenShell
      title={zh.brain.sections.memoryPrefs}
      hint={brainLogicHints.memoryPrefs}
      onBack={() => _props.navigation.goBack()}
      loading={loading}
      onReload={() => void load()}
    >
      <View style={styles.row}>
        <View style={styles.textCol}>
          <Text style={styles.label}>{zh.me.memoryAutoExtract}</Text>
          <Text style={styles.hint}>{zh.me.memoryAutoExtractHint}</Text>
        </View>
        {loading ? (
          <ActivityIndicator color={brainTokens.accent} />
        ) : (
          <Switch
            value={enabled}
            onValueChange={onToggle}
            disabled={saving}
            trackColor={{ false: brainTokens.bgElevated, true: brainTokens.accentDim }}
            thumbColor={enabled ? brainTokens.accentBright : brainTokens.textMuted}
          />
        )}
      </View>
      <Text style={styles.limits}>
        {zh.me.memoryLimitsHint}（{MEMORY_USER_PROFILE_CHAR_LIMIT} /{' '}
        {MEMORY_PROJECT_NOTE_CHAR_LIMIT}）
      </Text>
    </BrainScreenShell>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 12,
    padding: 16,
    backgroundColor: brainTokens.bgCard,
    borderRadius: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: brainTokens.border,
    gap: 12,
  },
  textCol: { flex: 1 },
  label: {
    fontSize: 15,
    fontWeight: '600',
    color: brainTokens.text,
  },
  hint: {
    marginTop: 6,
    fontSize: 13,
    color: brainTokens.textMuted,
    lineHeight: 18,
  },
  limits: {
    marginTop: 16,
    marginHorizontal: 16,
    fontSize: 12,
    color: brainTokens.textDim,
    lineHeight: 18,
  },
});
