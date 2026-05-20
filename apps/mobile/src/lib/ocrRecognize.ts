import { getTextFromFrame } from 'expo-text-recognition';

/** 本机识图（iOS Vision / Android ML Kit），不依赖 DeepSeek 看图接口 */
export async function recognizeImageText(asset: {
  uri: string;
  base64?: string | null;
}): Promise<string> {
  const lines = asset.base64
    ? await getTextFromFrame(asset.base64, true)
    : await getTextFromFrame(asset.uri, false);
  return lines
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}
