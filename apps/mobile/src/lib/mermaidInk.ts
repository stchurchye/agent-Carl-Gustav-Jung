/** UTF-8 文本 → base64，供 mermaid.ink 使用 */
export function mermaidInkImageUrl(code: string): string {
  const trimmed = code.trim();
  const b64 = utf8ToBase64(trimmed);
  return `https://mermaid.ink/img/${b64}?type=png&bgColor=!FAFAFA`;
}

function utf8ToBase64(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]!);
  }
  const btoaFn = globalThis.btoa;
  if (typeof btoaFn !== 'function') {
    throw new Error('btoa unavailable');
  }
  return btoaFn(binary);
}
