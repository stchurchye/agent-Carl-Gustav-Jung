/** 收到全文后逐字展示（适合中文） */
export function animateTypewriter(
  fullText: string,
  onUpdate: (visible: string) => void,
  options?: { charMs?: number; signal?: AbortSignal },
): Promise<void> {
  const charMs = options?.charMs ?? 32;
  const signal = options?.signal;

  return new Promise((resolve) => {
    if (!fullText) {
      onUpdate('');
      resolve();
      return;
    }

    let index = 0;
    const tick = () => {
      if (signal?.aborted) {
        onUpdate(fullText);
        resolve();
        return;
      }
      index += 1;
      onUpdate(fullText.slice(0, index));
      if (index >= fullText.length) {
        resolve();
        return;
      }
      setTimeout(tick, charMs);
    };
    onUpdate('');
    setTimeout(tick, charMs);
  });
}
