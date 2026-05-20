import type { RefObject } from 'react';
import { InteractionManager } from 'react-native';
import type { View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as MediaLibrary from 'expo-media-library';
import { captureRef } from 'react-native-view-shot';

export type ChapterSharePayload = {
  documentTitle: string;
  chapterTitle: string;
  body: string;
};

export function formatChapterShareText(payload: ChapterSharePayload): string {
  const { documentTitle, chapterTitle, body } = payload;
  return `${documentTitle}\n${chapterTitle}\n\n${body.trim()}`;
}

export async function copyChapterText(payload: ChapterSharePayload): Promise<void> {
  await Clipboard.setStringAsync(formatChapterShareText(payload));
}

/** 仅申请「保存到相册」权限（iOS 只需 NSPhotoLibraryAddUsageDescription） */
export async function ensureSaveToAlbumPermission(): Promise<void> {
  const permission = await MediaLibrary.requestPermissionsAsync(true);
  if (!permission.granted && permission.accessPrivileges !== 'limited') {
    throw new Error('PERMISSION_DENIED');
  }
}

async function captureChapterImage(viewRef: RefObject<View | null>): Promise<string> {
  const target = viewRef.current;
  if (!target) throw new Error('NO_VIEW');

  await new Promise<void>((resolve) => {
    InteractionManager.runAfterInteractions(() => resolve());
  });
  await new Promise((resolve) => setTimeout(resolve, 120));

  return captureRef(target, {
    format: 'png',
    quality: 1,
    result: 'tmpfile',
  });
}

export async function saveChapterImageToAlbum(
  viewRef: RefObject<View | null>,
): Promise<void> {
  await ensureSaveToAlbumPermission();
  const uri = await captureChapterImage(viewRef);
  await MediaLibrary.saveToLibraryAsync(uri);
}
