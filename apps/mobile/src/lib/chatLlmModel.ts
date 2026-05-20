import * as SecureStore from 'expo-secure-store';
import {
  ZENMUX_CHAT_DEFAULT_MODEL,
  ZENMUX_CHAT_MODEL_GROUPS,
  ZENMUX_CHAT_MODELS,
  isValidZenmuxChatModel,
  resolveZenmuxChatModel,
  zenmuxChatModelLabel,
  type ZenmuxChatModel,
  type ZenmuxChatModelGroupDef,
} from '@xzz/shared';

const KEY = 'xzz_chat_llm_model';

export {
  ZENMUX_CHAT_MODEL_GROUPS,
  ZENMUX_CHAT_MODELS,
  ZENMUX_CHAT_DEFAULT_MODEL,
  zenmuxChatModelLabel,
};
export type { ZenmuxChatModel, ZenmuxChatModelGroupDef };

export async function getChatLlmModel(): Promise<string> {
  try {
    const stored = await SecureStore.getItemAsync(KEY);
    return resolveZenmuxChatModel(stored);
  } catch {
    return ZENMUX_CHAT_DEFAULT_MODEL;
  }
}

export async function setChatLlmModel(modelId: string): Promise<void> {
  if (!isValidZenmuxChatModel(modelId)) {
    throw new Error('不支持的模型');
  }
  await SecureStore.setItemAsync(KEY, modelId);
}
