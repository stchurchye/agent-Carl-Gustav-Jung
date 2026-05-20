export type ComposeIconVariant = 'ai' | 'human';

/** 聊天输入栏图标（微信式底部栏） */
export const chatIcons = {
  /** 切换到键盘输入（两模式共用） */
  keyboard: require('../../assets/chat/icon-keyboard.png'),
  /** 文件名为设计稿导出名；麦克风图用于听写，声波图用于切换语音 */
  voiceHuman: require('../../assets/chat/icon-dictation-human.png'),
  voiceAi: require('../../assets/chat/icon-dictation-ai.png'),
  dictationHuman: require('../../assets/chat/icon-voice-human.png'),
  dictationAi: require('../../assets/chat/icon-voice-ai.png'),
  plusHuman: require('../../assets/chat/icon-plus-human.png'),
  plusAi: require('../../assets/chat/icon-plus-ai.png'),
  /** @deprecated 使用 plusHuman / plusAi */
  plus: require('../../assets/chat/icon-plus-human.png'),
  /** @deprecated 使用 composeBarIcons().voice */
  llmVoice: require('../../assets/chat/icon-dictation-ai.png'),
  /** @deprecated 使用 composeBarIcons().dictation */
  dictation: require('../../assets/chat/icon-voice-ai.png'),
  /** 顶部：朗读回复 */
  readAloud: require('../../assets/chat/icon-read-aloud.png'),
  /** 顶部：换话题 */
  topics: require('../../assets/chat/icon-topics.png'),
  /** 识图 / 相册选图 */
  ocr: require('../../assets/chat/icon-plus-ai.png'),
  /** 浮动问 AI：开启 / 关闭 */
  askAiActive: require('../../assets/chat/icon-ask-ai-active.png'),
  askAiInactive: require('../../assets/chat/icon-ask-ai-inactive.png'),
  /** @deprecated 使用 askAiActive / askAiInactive */
  askAi: require('../../assets/chat/icon-ask-ai-active.png'),
  /** 问 AI 用户消息角标 */
  askAiBadge: require('../../assets/chat/icon-ask-ai-badge.png'),
} as const;

export function composeBarIcons(variant: ComposeIconVariant = 'ai') {
  const ai = variant === 'ai';
  return {
    voice: ai ? chatIcons.voiceAi : chatIcons.voiceHuman,
    dictation: ai ? chatIcons.dictationAi : chatIcons.dictationHuman,
    plus: ai ? chatIcons.plusAi : chatIcons.plusHuman,
    keyboard: chatIcons.keyboard,
  };
}
