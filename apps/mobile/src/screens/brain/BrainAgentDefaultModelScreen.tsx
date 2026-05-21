/**
 * M1e Task 12：让用户选 agent 任务默认用哪个 LLM provider+model。
 * 存到 SecureStore（agentDefaultModel.ts），ChatScreen/GroupChatScreen 在触发
 * agent_run 前读，作为 agentOptions 传给后端 intent/execute。
 */
import { useCallback, useEffect, useState } from 'react';
import {
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
import { evaBrain } from '../../theme/evaBrain';
import type { BrainStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<BrainStackParamList, 'BrainAgentDefaultModel'>;

export function BrainAgentDefaultModelScreen({ navigation }: Props) {
  const [current, setCurrent] = useState<AgentDefaultModel | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setCurrent(await getAgentDefaultModel());
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

  const pick = useCallback(async (opt: AgentLlmModelOption) => {
    const next: AgentDefaultModel = {
      providerId: opt.providerId,
      modelId: opt.modelId,
    };
    await setAgentDefaultModel(next);
    setCurrent(next);
  }, []);

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
      <View style={styles.list}>
        {AGENT_LLM_MODEL_OPTIONS.map((opt) => {
          const selected =
            current?.providerId === opt.providerId &&
            current?.modelId === opt.modelId;
          return (
            <Pressable
              key={`${opt.providerId}::${opt.modelId}`}
              style={[styles.row, selected ? styles.rowSelected : null]}
              onPress={() => void pick(opt)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
            >
              <View style={styles.rowMain}>
                <Text style={styles.rowTitle}>{opt.label}</Text>
                <Text style={styles.rowSubtitle}>
                  {opt.providerId} · {opt.modelId}
                  {opt.hint ? `  ·  ${opt.hint}` : ''}
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
  rowSubtitle: {
    color: evaBrain.textMuted,
    fontSize: 12,
    marginTop: 4,
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
