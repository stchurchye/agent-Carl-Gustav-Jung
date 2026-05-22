/**
 * M1e Task 12 / M5B T8：让用户选 agent 任务默认用哪个 LLM provider+model。
 * 存到 SecureStore（agentDefaultModel.ts），ChatScreen/GroupChatScreen 在触发
 * agent_run 前读，作为 agentOptions 传给后端 intent/execute。
 * M5B: added missing-key hints and Alert-to-configure flow.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import {
  AGENT_LLM_MODEL_OPTIONS,
  type AgentLlmModelOption,
} from '@xzz/shared';
import { brainLogicHints } from '../../brain/logicHints';
import { BrainScreenShell } from '../../components/brain/BrainScreenShell';
import {
  getAgentDefaultModel,
  setAgentDefaultModel,
  type AgentDefaultModel,
} from '../../lib/agentDefaultModel';
import { getDeepSeekApiKey } from '../../lib/deepseekKey';
import { getZenMuxApiKey } from '../../lib/zenmuxKey';
import { navigateBrainTab } from '../../lib/navigateBrain';
import { evaBrain } from '../../theme/evaBrain';
import type { BrainStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<BrainStackParamList, 'BrainAgentDefaultModel'>;

export function BrainAgentDefaultModelScreen({ navigation }: Props) {
  const [current, setCurrent] = useState<AgentDefaultModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [missingKeys, setMissingKeys] = useState<{ deepseek: boolean; zenmux: boolean }>({
    deepseek: false,
    zenmux: false,
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [def, ds, zm] = await Promise.all([
        getAgentDefaultModel(),
        getDeepSeekApiKey(),
        getZenMuxApiKey(),
      ]);
      setCurrent(def);
      setMissingKeys({ deepseek: !ds, zenmux: !zm });
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  // 进入屏幕第一次也跑一下
  useEffect(() => {
    void load();
  }, [load]);

  const pick = useCallback(
    (opt: AgentLlmModelOption) => {
      if (missingKeys[opt.requiresKey]) {
        Alert.alert(
          '未配置 API Key',
          `使用 ${opt.label} 需要配置 ${opt.requiresKey === 'deepseek' ? 'DeepSeek' : 'ZenMux'} Key。`,
          [
            { text: '取消', style: 'cancel' },
            {
              text: '去配置',
              onPress: () => navigateBrainTab(navigation, 'BrainHomeKeys'),
            },
          ],
        );
        return;
      }
      const next: AgentDefaultModel = {
        providerId: opt.providerId,
        modelId: opt.modelId,
      };
      void setAgentDefaultModel(next);
      setCurrent(next);
    },
    [missingKeys, navigation],
  );

  return (
    <BrainScreenShell
      title="Agent 默认模型"
      hint={brainLogicHints.agentDefaultModel}
      onBack={() => navigation.goBack()}
      loading={loading}
    >
      <Text style={styles.intro}>
        触发 agent 任务（"帮我研究"、"整理一份报告"等）时默认使用的大模型。
        老任务保留它当时的选择，重试也会沿用老 run 的模型。
      </Text>
      <Text style={styles.tempHint}>该选择会成为发送时默认值，发送时仍可临时改</Text>
      <View style={styles.list}>
        {AGENT_LLM_MODEL_OPTIONS.map((opt) => {
          const selected =
            current?.providerId === opt.providerId &&
            current?.modelId === opt.modelId;
          const keyMissing = missingKeys[opt.requiresKey];
          return (
            <Pressable
              key={`${opt.providerId}::${opt.modelId}`}
              style={[styles.row, selected ? styles.rowSelected : null]}
              onPress={() => pick(opt)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
            >
              <View style={styles.rowMain}>
                <Text style={[styles.rowTitle, keyMissing && styles.rowTitleDisabled]}>
                  {opt.label}
                </Text>
                <Text style={[styles.rowSubtitle, keyMissing && styles.rowSubtitleDisabled]}>
                  {opt.providerId} · {opt.modelId}
                  {opt.hint ? `  ·  ${opt.hint}` : ''}
                  {keyMissing ? '  ·  未配置 Key' : ''}
                </Text>
              </View>
              {selected ? <Text style={styles.tick}>✓</Text> : null}
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.footnote}>
        选 ZenMux 系列模型时，请确认你已经在「家用钥匙」填了 ZenMux key；
        否则 agent 会自动走服务端 key（计费在服务端账号上）。
      </Text>
    </BrainScreenShell>
  );
}

const styles = StyleSheet.create({
  intro: {
    color: evaBrain.textMuted,
    fontSize: 13,
    lineHeight: 20,
    marginHorizontal: 16,
    marginBottom: 4,
  },
  tempHint: {
    color: evaBrain.accent,
    fontSize: 12,
    lineHeight: 18,
    marginHorizontal: 16,
    marginBottom: 12,
  },
  list: {
    marginHorizontal: 16,
    gap: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: evaBrain.bgCard,
    borderWidth: 1,
    borderColor: evaBrain.borderSubtle,
  },
  rowSelected: {
    borderColor: evaBrain.accent,
    backgroundColor: evaBrain.bgElevated,
  },
  rowMain: {
    flex: 1,
  },
  rowTitle: {
    color: evaBrain.text,
    fontSize: 15,
    fontWeight: '600',
  },
  rowTitleDisabled: {
    color: evaBrain.textDim,
  },
  rowSubtitle: {
    color: evaBrain.textMuted,
    fontSize: 12,
    marginTop: 4,
  },
  rowSubtitleDisabled: {
    color: evaBrain.textDim,
  },
  tick: {
    color: evaBrain.accent,
    fontSize: 18,
    marginLeft: 12,
  },
  footnote: {
    marginTop: 16,
    marginHorizontal: 16,
    color: evaBrain.textDim,
    fontSize: 12,
    lineHeight: 18,
  },
});
