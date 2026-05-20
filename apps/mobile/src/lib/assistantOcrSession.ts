import { Platform } from 'react-native';
import { appAlert } from './appAlert';
import * as ImagePicker from 'expo-image-picker';
import { zh } from '../locales/zh-CN';

export type PickedOcrImage = {
  uri: string;
  base64?: string | null;
  mimeType?: string | null;
};

/** 在关闭小助手弹窗后调用，避免 iPad 上系统相册嵌套 Modal 无法确认/关闭 */
export async function pickAssistantOcrImage(): Promise<PickedOcrImage | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) {
    appAlert('提示', zh.writing.ocrPermissionDenied);
    return null;
  }

  const picked = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 0.85,
    base64: true,
    // 裁剪页在 iPad 上易导致选图后无确认、流程卡住
    allowsEditing: false,
    presentationStyle:
      Platform.OS === 'ios'
        ? ImagePicker.UIImagePickerPresentationStyle.FULL_SCREEN
        : undefined,
  });

  if (picked.canceled || !picked.assets[0]) return null;

  const asset = picked.assets[0];
  return {
    uri: asset.uri,
    base64: asset.base64,
    mimeType: asset.mimeType ?? 'image/jpeg',
  };
}
