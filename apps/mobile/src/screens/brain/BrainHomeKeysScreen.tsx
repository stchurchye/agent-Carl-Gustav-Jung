import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { apiKeySlotLabel } from '../../brain/apiKeyBrainHint';
import { brainLogicHints } from '../../brain/logicHints';
import { BrainKeyRow } from '../../components/brain/BrainKeyRow';
import { BrainScreenShell } from '../../components/brain/BrainScreenShell';
import { API_KEY_KINDS, loadApiKeyStatus } from '../../lib/apiKeyKind';
import type { ApiKeyKind } from '../../lib/apiKeyKind';
import { apiKeyKindConfig } from '../../lib/apiKeyKind';
import { zh } from '../../locales/zh-CN';
import type { BrainStackParamList } from '../../navigation/types';
import { evaBrain } from '../../theme/evaBrain';

type Props = NativeStackScreenProps<BrainStackParamList, 'BrainHomeKeys'>;

export function BrainHomeKeysScreen({ navigation }: Props) {
  const [status, setStatus] = useState<Record<ApiKeyKind, string>>({
    deepseek: zh.me.deepseekNotConfigured,
    zenmux: zh.me.zenmuxNotConfigured,
    dashscope: zh.me.dashscopeNotConfigured,
  });
  const [configured, setConfigured] = useState<Record<ApiKeyKind, boolean>>({
    deepseek: false,
    zenmux: false,
    dashscope: false,
  });
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const results = await Promise.all(
        API_KEY_KINDS.map(async (kind) => {
          const r = await loadApiKeyStatus(kind);
          return { kind, ...r };
        }),
      );
      setStatus(
        Object.fromEntries(results.map((r) => [r.kind, r.statusLabel])) as Record<ApiKeyKind, string>,
      );
      setConfigured(
        Object.fromEntries(results.map((r) => [r.kind, r.configured])) as Record<ApiKeyKind, boolean>,
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return (
    <BrainScreenShell
      title={zh.brain.sections.homeKeys}
      hint={brainLogicHints.homeKeys}
      onBack={() => navigation.goBack()}
      loading={loading}
      onReload={() => void load()}
    >
      <Text style={styles.intro}>{zh.brain.homeKeysIntro}</Text>
      <View style={styles.list}>
        {API_KEY_KINDS.map((kind) => {
          const cfg = apiKeyKindConfig(kind);
          return (
            <BrainKeyRow
              key={kind}
              slotLabel={apiKeySlotLabel(kind)}
              title={cfg.title}
              status={status[kind]}
              configured={configured[kind]}
              onPress={() => navigation.navigate('ApiKeyDetail', { kind })}
            />
          );
        })}
      </View>
      <Text style={styles.footnote}>{zh.brain.homeKeysDetail.privacy}</Text>
    </BrainScreenShell>
  );
}

const styles = StyleSheet.create({
  intro: {
    color: evaBrain.textMuted,
    fontSize: 13,
    lineHeight: 20,
    marginHorizontal: 16,
    marginBottom: 12,
  },
  list: {
    marginHorizontal: 16,
    gap: 10,
  },
  footnote: {
    marginTop: 16,
    marginHorizontal: 16,
    color: evaBrain.textDim,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
});
