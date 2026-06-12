import { Pressable, StyleSheet } from 'react-native';
import { buildUiIconSprite } from '../pixel/grids/uiIcons';
import type { UiIconKey } from '../pixel/grids/uiIcons';
import { PixelSprite } from './pixel/PixelSprite';
import { wechat } from '../theme/wechat';

type Props = {
  icon: UiIconKey;
  onPress: () => void;
  active?: boolean;
  accessibilityLabel?: string;
  testID?: string;
  size?: number;
};

const ICON_COLOR = wechat.textPrimary;

export function PixelIconButton({
  icon,
  onPress,
  active,
  accessibilityLabel,
  testID,
  size = 22,
}: Props) {
  const sprite = buildUiIconSprite(icon, ICON_COLOR);

  return (
    <Pressable
      style={({ pressed }) => [
        styles.btn,
        active && styles.btnActive,
        pressed && styles.btnPressed,
        !active && styles.btnInactive,
      ]}
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
    >
      <PixelSprite sprite={sprite} size={size} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
  },
  btnActive: {
    backgroundColor: 'rgba(0,0,0,0.06)',
  },
  btnPressed: {
    opacity: 0.55,
  },
  btnInactive: {
    opacity: 0.72,
  },
});
