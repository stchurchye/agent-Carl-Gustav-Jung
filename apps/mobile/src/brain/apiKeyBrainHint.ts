import type { BrainLogicHint } from './logicHints';
import type { ApiKeyKind } from '../lib/apiKeyKind';
import { apiKeyKindConfig } from '../lib/apiKeyKind';

const HINTS: Record<ApiKeyKind, BrainLogicHint> = {
  deepseek: {
    howRemember:
      '在本页把服务商给你的密钥粘贴进输入框，点保存即可；想换掉或不用了，点清除。密钥只留在本机，不会以明文上传到服务器，服务器只知道「这一格配好了没有」。',
    howUse:
      '工作台私聊、写文稿、以及大部分「Bow Wow 在心里想怎么答」时，都会用这把密钥去连对话模型。没配或配错时，这些功能会连不上或报错，识图、朗读不受影响（它们用另外两把）。',
  },
  zenmux: {
    howRemember:
      '在本页粘贴密钥后点保存；清除后本机不再保留。和对话那份分开存，互不影响；换手机需要重新在这里填一遍。',
    howUse:
      '发图让 AI 认字、按住说话转成文字，以及部分需要多模型能力的场景，会用这份凭证。日常纯文字聊天、朗读消息不走这里。',
  },
  dashscope: {
    howRemember:
      '在本页粘贴阿里云百炼（或其它支持的）密钥并保存；清除即停用朗读。同样只存在你手机里，别人拿不到明文。',
    howUse:
      '你在聊天里点某条消息的「朗读」时，会把文字发给语音服务生成音频，这一步用这份凭证。不点朗读、只打字聊天，不会用到它。',
  },
};

export function apiKeyBrainHint(kind: ApiKeyKind): BrainLogicHint {
  return HINTS[kind];
}

export function apiKeySlotLabel(kind: ApiKeyKind): string {
  return apiKeyKindConfig(kind).title;
}
