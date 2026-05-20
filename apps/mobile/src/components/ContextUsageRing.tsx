import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';
import { colors } from '../theme/colors';

const SIZE = 24;
const STROKE = 2.5;
/** 让 border 弧段默认对准 12 点钟（再从此顺时针扫过） */
const START_OFFSET = -90;

type Props = {
  ratio: number;
  loading?: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
  accessibilityLabel: string;
};

function circleWedge(colors: {
  top: string;
  right?: string;
  left?: string;
}): ViewStyle {
  return {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    borderWidth: STROKE,
    borderTopColor: colors.top,
    borderRightColor: colors.right ?? 'transparent',
    borderBottomColor: 'transparent',
    borderLeftColor: colors.left ?? 'transparent',
  };
}

/**
 * 双半圆裁剪圆环（不依赖 react-native-svg）。
 * 从 12 点钟方向顺时针填充，与 Cursor 一致。
 */
function RingGraphic({ ratio, loading }: { ratio: number; loading?: boolean }) {
  const clamped = Math.min(1, Math.max(0, ratio));
  const percent = Math.round(clamped * 100);
  const arcColor =
    percent >= 85 ? colors.error : percent >= 70 ? colors.primary : colors.textMuted;
  const fillColor = loading ? colors.border : arcColor;

  const angle = clamped * 360;
  const rightRotate = START_OFFSET + Math.min(angle, 180);
  const showLeft = angle > 180;
  const leftRotate = START_OFFSET + Math.max(angle - 180, 0);

  return (
    <View
      style={styles.graphic}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <View style={[styles.track, { borderColor: colors.border }]} />

      {clamped > 0.001 && !loading ? (
        <>
          <View style={styles.halfClipRight}>
            <View
              style={[
                circleWedge({ top: fillColor, right: fillColor }),
                styles.wedgeRight,
                { transform: [{ rotate: `${rightRotate}deg` }] },
              ]}
            />
          </View>
          {showLeft ? (
            <View style={styles.halfClipLeft}>
              <View
                style={[
                  circleWedge({ top: fillColor, left: fillColor }),
                  styles.wedgeLeft,
                  { transform: [{ rotate: `${leftRotate}deg` }] },
                ]}
              />
            </View>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

export function ContextUsageRing({
  ratio,
  loading,
  onPress,
  onLongPress,
  accessibilityLabel,
}: Props) {
  const displayRatio = loading ? 0 : ratio;

  const ring = (
    <View style={styles.wrap}>
      <RingGraphic ratio={displayRatio} loading={loading} />
    </View>
  );

  if (!onPress && !onLongPress) return ring;

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      hitSlop={4}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={styles.pressable}
    >
      {ring}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressable: {
    width: SIZE,
    height: SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wrap: {
    width: SIZE,
    height: SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  graphic: {
    width: SIZE,
    height: SIZE,
    overflow: 'hidden',
  },
  track: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: SIZE / 2,
    borderWidth: STROKE,
  },
  halfClipRight: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: SIZE / 2,
    height: SIZE,
    overflow: 'hidden',
  },
  halfClipLeft: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: SIZE / 2,
    height: SIZE,
    overflow: 'hidden',
  },
  wedgeRight: {
    position: 'absolute',
    top: 0,
    left: -SIZE / 2,
  },
  wedgeLeft: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
});
