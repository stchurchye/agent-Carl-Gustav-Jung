import * as ImagePicker from 'expo-image-picker';
import {
  PROFILE_AVATAR_DISPLAY_PX,
  PROFILE_AVATAR_DISPLAY_QUALITY,
} from '@xzz/shared';

export type ProfileAvatarPick = {
  mimeType: string;
  originalDataUrl: string;
  displayDataUrl: string;
};

/** 开发版/Expo Go 无原生模块时，展示图暂用原图（需 expo run:ios 才启用裁剪压缩） */
async function buildDisplayDataUrl(uri: string): Promise<string | null> {
  try {
    const ImageManipulator = await import('expo-image-manipulator');
    const display = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: PROFILE_AVATAR_DISPLAY_PX, height: PROFILE_AVATAR_DISPLAY_PX } }],
      {
        compress: PROFILE_AVATAR_DISPLAY_QUALITY,
        format: ImageManipulator.SaveFormat.JPEG,
        base64: true,
      },
    );
    if (!display.base64) return null;
    return `data:image/jpeg;base64,${display.base64.replace(/\s/g, '')}`;
  } catch {
    return null;
  }
}

export async function pickProfileAvatar(): Promise<
  ProfileAvatarPick | null | 'denied'
> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return 'denied';

  const picked = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: [1, 1],
    quality: 1,
    base64: true,
  });
  if (picked.canceled || !picked.assets[0]?.base64) return null;

  const asset = picked.assets[0];
  const rawBase64 = asset.base64;
  if (!rawBase64) return null;
  const mimeType = asset.mimeType ?? 'image/jpeg';
  const originalDataUrl = `data:${mimeType};base64,${rawBase64.replace(/\s/g, '')}`;

  const displayDataUrl =
    (await buildDisplayDataUrl(asset.uri)) ?? originalDataUrl;

  return {
    mimeType,
    originalDataUrl,
    displayDataUrl,
  };
}
