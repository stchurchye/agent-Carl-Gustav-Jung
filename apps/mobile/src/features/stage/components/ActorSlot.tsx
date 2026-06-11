import React, { useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { PixelCharacter } from '../../../components/pixel/PixelCharacter';
import type { CharacterMotion, CompiledCharacter } from '../../../pixel/types';
import type { StageActor } from '../stageTypes';

type Props = {
  actor: StageActor;
  character: CompiledCharacter;
  motion: CharacterMotion;
  size: number;
  speaking?: boolean;
  /** 等授权/等回答:头顶「!」 */
  attention?: boolean;
  /** 点按飘字(狗汪猫喵);缺省按 kind 兜底 */
  bark?: string;
  onPress?: (actor: StageActor) => void;
  testID?: string;
};

/**
 * 舞台上的一个角色:立绘 + 名牌 + 按压互动。
 * 按下压扁(squash)、松手弹起 + 头顶飘「汪!」,随后父级打开历史浮层——
 * "点击狗有动的交互"和"点狗看历史"同一手势满足。
 */
export function ActorSlot({
  actor,
  character,
  motion,
  size,
  speaking,
  attention,
  bark,
  onPress,
  testID,
}: Props) {
  const squash = useRef(new Animated.Value(0)).current;
  const barkOp = useRef(new Animated.Value(0)).current;
  const barkY = useRef(new Animated.Value(0)).current;
  const [barkCount, setBarkCount] = useState(0);

  const pressIn = () => {
    Animated.timing(squash, {
      toValue: 1,
      duration: 90,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  };

  const pressOut = () => {
    Animated.sequence([
      Animated.timing(squash, { toValue: -0.6, duration: 110, useNativeDriver: true }),
      Animated.spring(squash, { toValue: 0, friction: 4, useNativeDriver: true }),
    ]).start();
    // 飘「汪!」:连点会重置动画(摸狗手感)
    setBarkCount((c) => c + 1);
    barkOp.setValue(1);
    barkY.setValue(0);
    Animated.parallel([
      Animated.timing(barkOp, { toValue: 0, duration: 620, useNativeDriver: true }),
      Animated.timing(barkY, { toValue: -18, duration: 620, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    ]).start();
  };

  const scaleY = squash.interpolate({ inputRange: [-1, 0, 1], outputRange: [1.08, 1, 0.82] });
  const scaleX = squash.interpolate({ inputRange: [-1, 0, 1], outputRange: [0.95, 1, 1.1] });

  return (
    <Pressable
      onPressIn={pressIn}
      onPressOut={pressOut}
      onPress={() => onPress?.(actor)}
      style={[styles.slot, !speaking && styles.idle]}
      testID={testID}
    >
      <View style={{ width: size, height: size + 18 }}>
        {barkCount > 0 ? (
          <Animated.Text
            style={[styles.bark, { opacity: barkOp, transform: [{ translateY: barkY }] }]}
          >
            {bark ?? (actor.kind === 'dog' ? '汪!' : '!')}
          </Animated.Text>
        ) : null}
        {attention ? (
          <View style={styles.badge} testID={`${testID ?? actor.id}-attention`}>
            <Text style={styles.badgeText}>!</Text>
          </View>
        ) : null}
        <Animated.View style={{ marginTop: 18, transform: [{ scaleY }, { scaleX }] }}>
          <PixelCharacter
            character={character}
            size={size}
            motion={motion}
            animated
            speaking={speaking}
          />
        </Animated.View>
      </View>
      <View style={styles.namePlate}>
        <Text style={styles.nameText} numberOfLines={1}>
          {actor.name}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  slot: { alignItems: 'center', marginHorizontal: 6 },
  idle: { opacity: 0.6 },
  bark: {
    position: 'absolute',
    top: 0,
    alignSelf: 'center',
    fontSize: 13,
    fontWeight: '800',
    color: '#B3542F',
  },
  badge: {
    position: 'absolute',
    top: 2,
    right: 0,
    width: 18,
    height: 18,
    borderRadius: 3,
    borderWidth: 2,
    borderColor: '#3D3229',
    backgroundColor: '#E8B04B',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  badgeText: { fontSize: 12, fontWeight: '900', color: '#3D3229' },
  namePlate: {
    marginTop: 4,
    backgroundColor: '#3D3229',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 3,
    maxWidth: 90,
  },
  nameText: { color: '#FAF6EC', fontSize: 11, fontWeight: '700' },
});
