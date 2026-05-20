import { zh } from '../locales/zh-CN';

/** 等待回复 */
export async function getAssistantThinkingLine(): Promise<string> {
  return zh.writing.thinkingZh;
}

/** 等待较久时的提示 */
export async function getAssistantThinkingLongLine(): Promise<string> {
  return zh.writing.thinkingLongZh;
}

/** 用户确认改稿后的等待话术 */
export async function getAssistantContinueLine(): Promise<string> {
  return zh.writing.continueActionZh;
}
