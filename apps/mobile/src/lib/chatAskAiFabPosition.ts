import * as SecureStore from 'expo-secure-store';

const KEY = 'xzz_chat_ask_ai_fab_pos';

/** 相对聊天内容区（0~1），左上角为原点 */
export type AskAiFabPosition = {
  x: number;
  y: number;
};

export const DEFAULT_ASK_AI_FAB_POSITION: AskAiFabPosition = { x: 0.78, y: 0.62 };

function clamp(n: number): number {
  return Math.min(1, Math.max(0, n));
}

export async function getAskAiFabPosition(): Promise<AskAiFabPosition> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    if (!raw) return DEFAULT_ASK_AI_FAB_POSITION;
    const parsed = JSON.parse(raw) as AskAiFabPosition;
    if (typeof parsed.x !== 'number' || typeof parsed.y !== 'number') {
      return DEFAULT_ASK_AI_FAB_POSITION;
    }
    return { x: clamp(parsed.x), y: clamp(parsed.y) };
  } catch {
    return DEFAULT_ASK_AI_FAB_POSITION;
  }
}

export async function setAskAiFabPosition(pos: AskAiFabPosition): Promise<void> {
  await SecureStore.setItemAsync(
    KEY,
    JSON.stringify({ x: clamp(pos.x), y: clamp(pos.y) }),
  );
}
