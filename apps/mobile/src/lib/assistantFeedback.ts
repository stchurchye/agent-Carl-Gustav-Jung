import { stopCues } from './soundCues';

/**
 * 助手反馈已从「TTS 朗读回复」改为「提示音」(见 soundCues.ts)。
 * 朗读内容功能已下线;此处只保留「打断当前提示音」的入口,供用户开始说话/发送时调用。
 */
export async function cancelAssistantFeedback(): Promise<void> {
  await stopCues();
}
