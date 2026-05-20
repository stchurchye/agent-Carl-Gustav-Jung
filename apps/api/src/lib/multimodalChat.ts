import type { ChatAttachment } from '@xzz/shared';

export type MultimodalPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export function buildUserTurn(params: {
  text: string;
  attachments: ChatAttachment[];
}): MultimodalPart[] {
  const parts: MultimodalPart[] = [];
  if (params.text.trim()) {
    parts.push({ type: 'text', text: params.text.trim() });
  }
  for (const a of params.attachments) {
    const url = a.storageKey.startsWith('data:')
      ? a.storageKey
      : `data:${a.mimeType};base64,${a.storageKey}`;
    parts.push({ type: 'image_url', image_url: { url } });
  }
  return parts;
}

export function attachmentsFromDataUrls(
  items: Array<{ mimeType: string; dataUrl: string }>,
): ChatAttachment[] {
  return items.map((item, i) => ({
    id: `inline-${i}`,
    kind: 'image' as const,
    mimeType: item.mimeType,
    storageKey: item.dataUrl,
  }));
}
