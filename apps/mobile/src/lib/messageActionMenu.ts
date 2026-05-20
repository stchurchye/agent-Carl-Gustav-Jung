import type { MessageBubbleAnchor } from '../components/chat/MessageBubbleAnchor';

export type MessageActionTarget<T> = {
  message: T;
  copyText: string;
  anchor: MessageBubbleAnchor;
  canMark: boolean;
};

export function openMessageAction<T>(
  params: {
    message: T;
    copyText: string;
    anchor: MessageBubbleAnchor;
    canMark: boolean;
  },
  setTarget: (target: MessageActionTarget<T> | null) => void,
): void {
  if (!params.copyText.trim() && !params.canMark) return;
  setTarget({
    message: params.message,
    copyText: params.copyText,
    anchor: params.anchor,
    canMark: params.canMark,
  });
}
