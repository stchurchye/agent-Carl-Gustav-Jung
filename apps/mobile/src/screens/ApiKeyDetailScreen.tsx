import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { apiKeyBrainHint } from '../brain/apiKeyBrainHint';
import { BrainScreenShell } from '../components/brain/BrainScreenShell';
import { appAlert } from '../lib/appAlert';
import { apiErrorText } from '../lib/apiError';
import { apiKeyKindConfig, loadApiKeyStatus } from '../lib/apiKeyKind';
import { zh } from '../locales/zh-CN';
import type { BrainStackParamList } from '../navigation/types';
import { brainTokens } from '../theme/brainTokens';

type Props = NativeStackScreenProps<BrainStackParamList, 'ApiKeyDetail'>;

export function ApiKeyDetailScreen({ route, navigation }: Props) {
  const { kind } = route.params;
  // 必须 memo：apiKeyKindConfig 每次返回新对象，否则 reload(useCallback) 每帧变身份，
  // useFocusEffect 无限重跑 → 永久 loading、输入框不渲染。
  const cfg = useMemo(() => apiKeyKindConfig(kind), [kind]);
  const D = zh.brain.homeKeysDetail;

  const [input, setInput] = useState('');
  const [hasStored, setHasStored] = useState(false);
  const [edited, setEdited] = useState(false);
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [statusLabel, setStatusLabel] = useState(cfg.notConfiguredLabel);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const local = await cfg.getLocal();
      const server = await cfg.getServerConfigured();
      const ok = Boolean(local) || server;
      setConfigured(ok);
      setHasStored(Boolean(local));
      setEdited(false);
      if (local) {
        setInput(cfg.mask(local));
      } else {
        setInput('');
      }
      const { statusLabel: label } = await loadApiKeyStatus(kind);
      setStatusLabel(label);
    } finally {
      setLoading(false);
    }
  }, [cfg, kind]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const onChangeText = (text: string) => {
    setEdited(true);
    setInput(text);
  };

  const onSave = async () => {
    const trimmed = input.trim();
    setSaving(true);
    try {
      if (!trimmed) {
        if (!hasStored) {
          appAlert('提示', zh.brain.homeKeysDetail.keyRequired);
          return;
        }
        await cfg.clearLocal();
        setHasStored(false);
        setConfigured(await cfg.getServerConfigured());
        setInput('');
        setEdited(false);
        appAlert('已清除', cfg.clearedMessage);
        await reload();
        return;
      }

      if (hasStored && !edited) {
        return;
      }

      await cfg.setLocal(trimmed);
      const masked = cfg.mask(trimmed);
      setInput(masked);
      setHasStored(true);
      setEdited(false);
      setConfigured(true);
      appAlert('已保存', cfg.savedMessage);
      await reload();
    } finally {
      setSaving(false);
    }
  };

  const onVerify = async () => {
    if (!configured) {
      appAlert('请先保存密钥', '保存后再测试是否可用。');
      return;
    }
    if (edited && input.trim()) {
      appAlert('请先保存', '您修改了密钥，请先点「保存」再测试。');
      return;
    }
    setVerifying(true);
    try {
      const res = await cfg.verify();
      appAlert('太好了', res.message || cfg.verifyOk);
      await reload();
    } catch (e) {
      const { message, hint } = apiErrorText(e);
      appAlert(cfg.verifyFail, [message, hint].filter(Boolean).join('\n'));
    } finally {
      setVerifying(false);
    }
  };

  const onClear = async () => {
    if (!hasStored) return;
    setSaving(true);
    try {
      await cfg.clearLocal();
      setHasStored(false);
      setConfigured(await cfg.getServerConfigured());
      setInput('');
      setEdited(false);
      appAlert('已清除', cfg.clearedMessage);
      await reload();
    } finally {
      setSaving(false);
    }
  };

  return (
    <BrainScreenShell
      title={cfg.title}
      hint={apiKeyBrainHint(kind)}
      onBack={() => navigation.goBack()}
      loading={loading}
      onReload={() => void reload()}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={8}
      >
        <View style={styles.statusCard}>
          <View style={styles.statusRow}>
            <View style={[styles.statusDot, configured ? styles.statusDotOn : styles.statusDotOff]} />
            <Text style={styles.statusTitle}>
              {configured ? D.statusOn : D.statusOff}
            </Text>
          </View>
          <Text style={styles.statusSub}>{statusLabel}</Text>
        </View>

        <Text style={styles.hint}>{cfg.hint}</Text>

        <View style={styles.inputCard}>
          <Text style={styles.inputLabel}>〔 {D.fieldLabel} 〕</Text>
          <TextInput
            style={styles.input}
            placeholder={cfg.placeholder}
            placeholderTextColor={brainTokens.textDim}
            value={input}
            onChangeText={onChangeText}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="off"
            textContentType="password"
            selectionColor={brainTokens.accent}
          />
        </View>

        <View style={styles.actions}>
          <Pressable
            style={({ pressed }) => [
              styles.btn,
              styles.btnPrimary,
              (saving || verifying) && styles.btnDisabled,
              pressed && styles.btnPressed,
            ]}
            onPress={() => void onSave()}
            disabled={saving || verifying}
          >
            {saving ? (
              <ActivityIndicator color={brainTokens.bg} />
            ) : (
              <Text style={styles.btnPrimaryText}>{cfg.saveLabel}</Text>
            )}
          </Pressable>
          <Pressable
            style={({ pressed }) => [
              styles.btn,
              styles.btnSecondary,
              (!configured || verifying || saving) && styles.btnDisabled,
              pressed && styles.btnPressed,
            ]}
            onPress={() => void onVerify()}
            disabled={verifying || saving || !configured}
          >
            {verifying ? (
              <ActivityIndicator color={brainTokens.accent} />
            ) : (
              <Text style={styles.btnSecondaryText}>{cfg.verifyLabel}</Text>
            )}
          </Pressable>
        </View>

        {hasStored ? (
          <Pressable
            style={styles.clearBtn}
            onPress={() => void onClear()}
            disabled={saving || verifying}
          >
            <Text style={styles.clearText}>{D.clear}</Text>
          </Pressable>
        ) : null}

        <Text style={styles.footnote}>{D.privacy}</Text>
      </KeyboardAvoidingView>
    </BrainScreenShell>
  );
}

const styles = StyleSheet.create({
  statusCard: {
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 14,
    backgroundColor: brainTokens.bgCard,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: brainTokens.border,
    borderRadius: 4,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
  },
  statusDotOn: { backgroundColor: brainTokens.accent },
  statusDotOff: { backgroundColor: brainTokens.textDim },
  statusTitle: {
    color: brainTokens.accentBright,
    fontSize: 14,
    fontWeight: '700',
  },
  statusSub: {
    marginTop: 8,
    color: brainTokens.textMuted,
    fontSize: 13,
    lineHeight: 18,
  },
  hint: {
    marginHorizontal: 16,
    marginBottom: 12,
    color: brainTokens.textMuted,
    fontSize: 13,
    lineHeight: 20,
  },
  inputCard: {
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 14,
    backgroundColor: brainTokens.bgElevated,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: brainTokens.border,
    borderRadius: 4,
  },
  inputLabel: {
    color: brainTokens.accent,
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 10,
  },
  input: {
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: brainTokens.bg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: brainTokens.borderSubtle,
    borderRadius: 4,
    color: brainTokens.text,
    fontSize: 15,
    fontFamily: brainTokens.mono,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginHorizontal: 16,
  },
  btn: {
    flex: 1,
    minHeight: 48,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  btnPrimary: {
    backgroundColor: brainTokens.accent,
    borderColor: brainTokens.accentBright,
  },
  btnSecondary: {
    backgroundColor: brainTokens.bgCard,
    borderColor: brainTokens.accent,
  },
  btnDisabled: { opacity: 0.45 },
  btnPressed: { opacity: 0.85 },
  btnPrimaryText: {
    color: brainTokens.bg,
    fontSize: 15,
    fontWeight: '700',
  },
  btnSecondaryText: {
    color: brainTokens.accentBright,
    fontSize: 15,
    fontWeight: '600',
  },
  clearBtn: {
    marginTop: 16,
    marginHorizontal: 16,
    alignItems: 'center',
    paddingVertical: 10,
  },
  clearText: {
    color: brainTokens.error,
    fontSize: 14,
  },
  footnote: {
    marginTop: 8,
    marginHorizontal: 16,
    color: brainTokens.textDim,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
});
