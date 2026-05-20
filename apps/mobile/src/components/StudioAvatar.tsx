import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme/colors';
import { wechat } from '../theme/wechat';

const AVATAR_PALETTE = [
  { bg: '#7cb342', fg: '#ffffff' },
  { bg: '#5c6bc0', fg: '#ffffff' },
  { bg: '#26a69a', fg: '#ffffff' },
  { bg: '#ef5350', fg: '#ffffff' },
  { bg: '#ab47bc', fg: '#ffffff' },
  { bg: '#ffa726', fg: '#ffffff' },
  { bg: '#42a5f5', fg: '#ffffff' },
  { bg: '#8d6e63', fg: '#ffffff' },
];

function paletteIndex(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % AVATAR_PALETTE.length;
}

type Props = {
  name: string;
  seed: string;
  size?: number;
};

export function StudioAvatar({ name, seed, size = 48 }: Props) {
  const palette = AVATAR_PALETTE[paletteIndex(seed)]!;
  const label = (name.trim()[0] ?? '工').toUpperCase();

  return (
    <View
      style={[
        styles.circle,
        {
          width: size,
          height: size,
          borderRadius: wechat.avatarRadius,
          backgroundColor: palette.bg,
        },
      ]}
    >
      <Text style={[styles.label, { color: palette.fg, fontSize: size * 0.42 }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  circle: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  label: { fontWeight: '700' },
});
