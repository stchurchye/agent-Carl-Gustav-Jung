import {
  formatResponseTimeMs,
  formatTokenCount,
  type LlmReplyMeta,
} from '@xzz/shared';
import { zenmuxChatModelLabel } from './chatLlmModel';

/** AI 回复气泡上方：模型 · token · 耗时 */
export function formatLlmReplyCaption(meta: LlmReplyMeta): string {
  const model = zenmuxChatModelLabel(meta.model);
  const tokens = formatTokenCount(meta.totalTokens);
  const time = formatResponseTimeMs(meta.responseTimeMs);
  return `${model} · ${tokens} token · ${time}`;
}
