/**
 * 用户级偏好：Agent 默认 provider + model。
 * 存到 SecureStore（沿用 deepseekKey/zenmuxKey 的存储路径，无需新依赖）。
 *
 * 读：ChatScreen / GroupChatScreen 在发起 agent_run 前调一次 → 传到 agentOptions。
 * 写：BrainHomeAgentDefaultsScreen（task 12 UI）。
 */
import * as SecureStore from 'expo-secure-store';
import {
  AGENT_LLM_DEFAULT_MODEL,
  AGENT_LLM_DEFAULT_PROVIDER,
  AGENT_LLM_MODEL_OPTIONS,
  type AgentLlmProviderId,
} from '@xzz/shared';

const KEY_PROVIDER = 'xzz_agent_default_provider';
const KEY_MODEL = 'xzz_agent_default_model';

export type AgentDefaultModel = {
  providerId: AgentLlmProviderId;
  modelId: string;
};

export async function getAgentDefaultModel(): Promise<AgentDefaultModel> {
  try {
    const providerId = (await SecureStore.getItemAsync(KEY_PROVIDER)) as
      | AgentLlmProviderId
      | null;
    const modelId = await SecureStore.getItemAsync(KEY_MODEL);
    if (!providerId || !modelId) return defaults();
    // 校验 (providerId, modelId) 在白名单内，避免老数据指向已下架的模型
    const ok = AGENT_LLM_MODEL_OPTIONS.some(
      (o) => o.providerId === providerId && o.modelId === modelId,
    );
    return ok ? { providerId, modelId } : defaults();
  } catch {
    return defaults();
  }
}

export async function setAgentDefaultModel(value: AgentDefaultModel): Promise<void> {
  await SecureStore.setItemAsync(KEY_PROVIDER, value.providerId);
  await SecureStore.setItemAsync(KEY_MODEL, value.modelId);
}

export async function resetAgentDefaultModel(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(KEY_PROVIDER);
    await SecureStore.deleteItemAsync(KEY_MODEL);
  } catch {
    // 容忍
  }
}

function defaults(): AgentDefaultModel {
  return {
    providerId: AGENT_LLM_DEFAULT_PROVIDER,
    modelId: AGENT_LLM_DEFAULT_MODEL,
  };
}
