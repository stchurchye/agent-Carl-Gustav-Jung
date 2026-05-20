/**
 * Expo SDK 54：主包 `expo-file-system` 的读写/删除已弃用并在运行时抛错，
 * 需使用 legacy 入口。
 */
import * as FileSystem from 'expo-file-system/legacy';

export async function readFileBase64(uri: string): Promise<string> {
  return FileSystem.readAsStringAsync(uri, { encoding: 'base64' });
}

export async function deleteFileQuietly(uri: string): Promise<void> {
  try {
    await FileSystem.deleteAsync(uri, { idempotent: true });
  } catch {
    // 清理临时录音失败不影响识图/听写结果
  }
}

/** 将 Base64 音频写入缓存目录，返回本地 file:// URI */
export async function writeBase64ToCacheFile(base64: string, ext = 'wav'): Promise<string> {
  const dir = FileSystem.cacheDirectory;
  if (!dir) throw new Error('无法写入缓存目录');
  const uri = `${dir}xzz-tts-${Date.now()}.${ext}`;
  await FileSystem.writeAsStringAsync(uri, base64, { encoding: 'base64' });
  return uri;
}
