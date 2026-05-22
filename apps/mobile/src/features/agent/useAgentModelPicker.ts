import { useState, useCallback, useEffect } from 'react';
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
  const [missingKeys, setMissingKeys] = useState<MissingKeys>({ deepseek: false, zenmux: false });
  const [sheetVisible, setSheetVisible] = useState(false);

  useEffect(() => {
    void (async () => {
      const def = await getAgentDefaultModel();
      const opt = findAgentLlmOption(def.providerId, def.modelId) ?? AGENT_LLM_MODEL_OPTIONS[0];
      setCurrent(opt);
      const [ds, zm] = await Promise.all([getDeepSeekApiKey(), getZenMuxApiKey()]);
      setMissingKeys({ deepseek: !ds, zenmux: !zm });
    })();
  }, []);

  const pick = useCallback(async (opt: AgentLlmModelOption) => {
    await setAgentDefaultModel({ providerId: opt.providerId, modelId: opt.modelId });
    setCurrent(opt);
    setSheetVisible(false);
  }, []);

  return { current, missingKeys, sheetVisible, setSheetVisible, pick };
}
