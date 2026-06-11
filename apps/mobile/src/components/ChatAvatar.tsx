import { Image, StyleSheet, Text, View } from 'react-native';
import { wechatChat } from '../theme/wechatChat';
import { avatarPalette } from '../theme/avatarPalette';

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
};

export function ChatAvatar({ name, seed, size = wechatChat.avatarSize, imageUri }: Props) {
  const bg = PALETTE[paletteIndex(seed)]!;
  const label = (name.trim()[0] ?? '?').toUpperCase();
  const radius = wechatChat.avatarRadius;

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
