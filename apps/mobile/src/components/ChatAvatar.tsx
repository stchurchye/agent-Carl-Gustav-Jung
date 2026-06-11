import { Image, StyleSheet, Text, View } from 'react-native';
import { wechatChat } from '../theme/wechatChat';
import { avatarPalette } from '../theme/avatarPalette';
import { PixelSprite } from './pixel/PixelSprite';
import type { CompiledSprite } from '../pixel/types';

const PALETTE = avatarPalette;

function paletteIndex(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % PALETTE.length;
}

type Props = {
  name: string;
  seed: string;
  size?: number;
  imageUri?: string | null;
  /** 像素形象(still 编译精灵);提供时优先于照片与首字母 */
  pixelSprite?: CompiledSprite | null;
};

export function ChatAvatar({
  name,
  seed,
  size = wechatChat.avatarSize,
  imageUri,
  pixelSprite,
}: Props) {
  const bg = PALETTE[paletteIndex(seed)]!;
  const label = (name.trim()[0] ?? '?').toUpperCase();
  const radius = wechatChat.avatarRadius;

  if (pixelSprite) {
    return (
      <View
        style={[
          styles.circle,
          {
            width: size,
            height: size,
            borderRadius: radius,
            backgroundColor: '#F4EFE4',
            overflow: 'hidden',
          },
        ]}
      >
        <PixelSprite sprite={pixelSprite} size={size * 0.92} />
      </View>
    );
  }

  if (imageUri) {
    return (
      <Image
        source={{ uri: imageUri }}
        style={{ width: size, height: size, borderRadius: radius }}
        resizeMode="cover"
      />
    );
  }

  return (
    <View
      style={[
        styles.circle,
        {
          width: size,
          height: size,
          borderRadius: radius,
          backgroundColor: bg,
        },
      ]}
    >
      <Text style={[styles.label, { fontSize: size * 0.38 }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  circle: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    color: '#ffffff',
    fontWeight: '700',
  },
});
