import { Image, StyleSheet, type ImageSourcePropType, type StyleProp, type ImageStyle } from 'react-native';

type Props = {
  source: ImageSourcePropType;
  size?: number;
  active?: boolean;
  style?: StyleProp<ImageStyle>;
};

export function ChatUiIcon({ source, size = 22, active, style }: Props) {
  return (
    <Image
      source={source}
      style={[styles.icon, { width: size, height: size }, !active && styles.inactive, style]}
      resizeMode="contain"
      accessibilityIgnoresInvertColors
    />
  );
}

const styles = StyleSheet.create({
  icon: {},
  inactive: {
    opacity: 0.72,
  },
});
