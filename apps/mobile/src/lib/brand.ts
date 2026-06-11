/** Bow wow know 品牌常量集中地:改品牌词只动这里,别在组件里散落字符串。 */

export const BRAND_NAME = 'Bow wow know';

/** 用户没给狗起名时的兜底称呼(与 @xzz/shared personaAssistantDisplayName 的默认值保持一致)。 */
export const ASSISTANT_FALLBACK_NAME = 'Bow wow';

export const DEFAULT_SESSION_TITLE = '和 Bow wow 聊聊';

/** 数据库存量会话与服务端(routes/chat.ts)仍会写入旧默认标题,判断"是否默认标题"必须双串兼容。 */
const LEGACY_DEFAULT_SESSION_TITLES = ['和小助手聊聊'];

export function isDefaultSessionTitle(title: string | null | undefined): boolean {
  const t = title?.trim();
  if (!t) return false;
  return t === DEFAULT_SESSION_TITLE || LEGACY_DEFAULT_SESSION_TITLES.includes(t);
}

/** 网络不可达提示前缀;tts.ts 用它做字符串匹配,改动必须三处同步(api.ts/apiRequest.ts/tts.ts)。 */
export const NETWORK_UNREACHABLE_PREFIX = '连不上 Bow wow 服务';
