import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import type { CharacterMotion, CompiledCharacter } from '../../pixel/types';
import { PixelSprite } from './PixelSprite';

type Props = {
  character: CompiledCharacter;
  size: number;
  motion: CharacterMotion;
  /** 列表/历史小头像传 false(默认):单 Svg 零定时器。舞台立绘才开动画。 */
  animated?: boolean;
  /** 正在说话:嘴动 + 弹跳 */
  speaking?: boolean;
  testID?: string;
};

/**
 * 帧动画原理:base 不含眼/嘴/尾,各部位是成对叠层,切帧只 setValue(opacity),零 re-render。
 * 呼吸/弹跳是整体 transform(useNativeDriver)。
 */
export function PixelCharacter({ character, size, motion, animated, speaking, testID }: Props) {
  const breath = useRef(new Animated.Value(0)).current;
  const bounce = useRef(new Animated.Value(0)).current;
  const eyesOpenOp = useRef(new Animated.Value(1)).current;
  const eyesClosedOp = useRef(new Animated.Value(0)).current;
  const mouthIdleOp = useRef(new Animated.Value(1)).current;
  const mouthTalkOp = useRef(new Animated.Value(0)).current;
  const tailIdleOp = useRef(new Animated.Value(1)).current;
  const tailWagOp = useRef(new Animated.Value(0)).current;

  // 呼吸:scaleY 1→0.97 循环,脚底锚定(translateY 补偿)
  useEffect(() => {
    if (!animated) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, {
          toValue: 1,
          duration: 1400,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(breath, {
          toValue: 0,
          duration: 1400,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [animated, breath]);

  // 说话弹跳
  useEffect(() => {
    if (!animated || !speaking) {
      bounce.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(bounce, {
          toValue: 1,
          duration: 160,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(bounce, {
          toValue: 0,
          duration: 160,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [animated, speaking, bounce]);

  // 眨眼:随机间隔,闭眼 120ms;setValue 直切不触发渲染
  useEffect(() => {
    if (!animated) return;
    let closeTimer: ReturnType<typeof setTimeout> | null = null;
    let openTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    const schedule = () => {
      const wait =
        motion.blinkMinMs + Math.random() * Math.max(1, motion.blinkMaxMs - motion.blinkMinMs);
      closeTimer = setTimeout(() => {
        if (cancelled) return;
        eyesOpenOp.setValue(0);
        eyesClosedOp.setValue(1);
        openTimer = setTimeout(() => {
          if (cancelled) return;
          eyesOpenOp.setValue(1);
          eyesClosedOp.setValue(0);
          schedule();
        }, 120);
      }, wait);
    };
    schedule();
    return () => {
      cancelled = true;
      if (closeTimer) clearTimeout(closeTimer);
      if (openTimer) clearTimeout(openTimer);
    };
  }, [animated, motion.blinkMinMs, motion.blinkMaxMs, eyesOpenOp, eyesClosedOp]);

  // 摇尾:wagMs 周期翻帧
  useEffect(() => {
    if (!animated || !character.tailWag || motion.wagMs <= 0) return;
    let wag = false;
    const timer = setInterval(() => {
      wag = !wag;
      tailIdleOp.setValue(wag ? 0 : 1);
      tailWagOp.setValue(wag ? 1 : 0);
    }, motion.wagMs);
    return () => clearInterval(timer);
  }, [animated, character.tailWag, motion.wagMs, tailIdleOp, tailWagOp]);

  // 嘴:speaking 时 140ms 翻帧,停下回 idle
  useEffect(() => {
    if (!animated) return;
    if (!speaking) {
      mouthIdleOp.setValue(1);
      mouthTalkOp.setValue(0);
      return;
    }
    let open = false;
    const timer = setInterval(() => {
      open = !open;
      mouthIdleOp.setValue(open ? 0 : 1);
      mouthTalkOp.setValue(open ? 1 : 0);
    }, 140);
    return () => {
      clearInterval(timer);
      mouthIdleOp.setValue(1);
      mouthTalkOp.setValue(0);
    };
  }, [animated, speaking, mouthIdleOp, mouthTalkOp]);

  if (!animated) {
    return <PixelSprite sprite={character.still} size={size} testID={testID} />;
  }

  const scaleY = breath.interpolate({ inputRange: [0, 1], outputRange: [1, 0.97] });
  const breathShift = breath.interpolate({
    inputRange: [0, 1],
    outputRange: [0, size * 0.015],
  });
  const bounceShift = bounce.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -size * motion.bounceRatio],
  });

  const layer = StyleSheet.absoluteFill;
  return (
    <Animated.View
      testID={testID}
      style={{
        width: size,
        height: size,
        transform: [{ translateY: Animated.add(breathShift, bounceShift) }, { scaleY }],
      }}
    >
      <PixelSprite sprite={character.base} size={size} />
      <Animated.View style={[layer, { opacity: eyesOpenOp }]}>
        <PixelSprite sprite={character.eyesOpen} size={size} />
      </Animated.View>
      <Animated.View style={[layer, { opacity: eyesClosedOp }]}>
        <PixelSprite sprite={character.eyesClosed} size={size} />
      </Animated.View>
      <Animated.View style={[layer, { opacity: mouthIdleOp }]}>
        <PixelSprite sprite={character.mouthIdle} size={size} />
      </Animated.View>
      <Animated.View style={[layer, { opacity: mouthTalkOp }]}>
        <PixelSprite sprite={character.mouthTalk} size={size} />
      </Animated.View>
      {character.tailIdle ? (
        <Animated.View style={[layer, { opacity: tailIdleOp }]}>
          <PixelSprite sprite={character.tailIdle} size={size} />
        </Animated.View>
      ) : null}
      {character.tailWag ? (
        <Animated.View style={[layer, { opacity: tailWagOp }]}>
          <PixelSprite sprite={character.tailWag} size={size} />
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}
