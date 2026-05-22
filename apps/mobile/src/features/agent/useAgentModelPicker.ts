import { useState, useCallback, useEffect } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  AGENT_LLM_MODEL_OPTIONS,
  findAgentLlmOption,
  type AgentLlmModelOption,
} from '@xzz/shared';
import { getAgentDefaultModel, setAgentDefaultModel } from '../../lib/agentDefaultModel';
import { getDeepSeekApiKey } from '../../lib/deepseekKey';
import { getZenMuxApiKey } from '../../lib/zenmuxKey';

export type MissingKeys = { deepseek: boolean; zenmux: boolean };

export function useAgentModelPicker() {
  const [current, setCurrent] = useState<AgentLlmModelOption>(AGENT_LLM_MODEL_OPTIONS[0]);
  const [missingKeys, setMissingKeys] = useState<MissingKeys>({ deepseek: true, zenmux: true });
  const [sheetVisible, setSheetVisible] = useState(false);

  const refresh = useCallback(async () => {
    const def = await getAgentDefaultModel();
    const opt = findAgentLlmOption(def.providerId, def.modelId) ?? AGENT_LLM_MODEL_OPTIONS[0];
    setCurrent(opt);
    const [ds, zm] = await Promise.all([getDeepSeekApiKey(), getZenMuxApiKey()]);
    setMissingKeys({ deepseek: !ds, zenmux: !zm });
  }, []);

  // 首次 mount 加载
  useEffect(() => { void refresh(); }, [refresh]);

  // 从「配置 Key」页面返回时重新读取，确保 missingKeys 及时更新
  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));

  const pick = useCallback(async (opt: AgentLlmModelOption) => {
    await setAgentDefaultModel({ providerId: opt.providerId, modelId: opt.modelId });
    setCurrent(opt);
    setSheetVisible(false);
  }, []);

  return { current, missingKeys, sheetVisible, setSheetVisible, pick };
}
