import { api } from './api';
import { readFileBase64 } from './fsLegacy';
import { OCR_RECOGNITION_PURPOSE } from '@xzz/shared';
import { recognizeImageText } from './ocrRecognize';
import { getZenMuxApiKey } from './zenmuxKey';

async function imageBase64(asset: {
  uri: string;
  base64?: string | null;
}): Promise<string | null> {
  if (asset.base64?.trim()) return asset.base64.replace(/\s/g, '');
  try {
    return await readFileBase64(asset.uri);
  } catch {
    return null;
  }
}

/** 已配置 ZenMux 时走云端 Gemini 识图，否则本机 Vision */
export async function recognizeImageFromAsset(asset: {
  uri: string;
  base64?: string | null;
  mimeType?: string | null;
}): Promise<string> {
  const zenmuxKey = await getZenMuxApiKey();
  if (zenmuxKey) {
    const b64 = await imageBase64(asset);
    if (b64) {
      const res = await api.ocrImage({
        imageBase64: b64,
        mimeType: asset.mimeType ?? 'image/jpeg',
        purpose: OCR_RECOGNITION_PURPOSE,
      });
      return res.data.text.trim();
    }
  }
  return recognizeImageText(asset);
}
