import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { colors } from '../../../theme/colors';
import type { StageBubbleTone } from '../agentStageText';

type Props = {
  text: string;
  speakerName?: string;
  tone?: StageBubbleTone;
  /** previous 方:小一号、压暗 */
  dimmed?: boolean;
  /** 思考中:文本旁加跳动点 */
  pending?: boolean;
  /** 气泡最大高;超出在框内上下滚动翻,一条消息完整可读 */
  maxHeight: number;
  onRetry?: () => void;
  /** 流式输出时自动跟滚到底;用户上滑离底则暂停 */
  followStream?: boolean;
  onPress?: () => void;
  testID?: string;
};

function ThinkingDots() {
  const v = useRef(new Animated.Value(0.3)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: 500, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(v, { toValue: 0.3, duration: 500, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [v]);
  return (
    <Animated.Text style={[styles.dots, { opacity: v }]} testID="bubble-pending">
      ● ● ●
    </Animated.Text>
  );
}

const TONE_BORDER: Record<StageBubbleTone, string> = {
  normal: '#3D3229',
  attention: colors.primary,
  error: colors.error ?? '#B3402F',
  muted: '#8A8377',
};

export function SpeechBubble({
  text,
  speakerName,
  tone = 'normal',
  dimmed,
  pending,
  maxHeight,
  onRetry,
  followStream,
  onPress,
  testID,
}: Props) {
  const scrollRef = useRef<ScrollView>(null);
  const [stickToEnd, setStickToEnd] = useState(true);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const distanceToEnd = contentSize.height - layoutMeasurement.height - contentOffset.y;
    setStickToEnd(distanceToEnd < 40);
  };

  return (
    <Pressable
      onPress={onPress}
      testID={testID}
      style={[
        styles.bubble,
        { maxHeight, borderColor: TONE_BORDER[tone] },
        dimmed && styles.dimmed,
        tone === 'error' && styles.errorBg,
      ]}
    >
      {speakerName ? (
        <View style={styles.namePlate}>
          <Text style={styles.namePlateText}>{speakerName}</Text>
        </View>
      ) : null}
      <ScrollView
        ref={scrollRef}
        nestedScrollEnabled
        onScroll={onScroll}
        scrollEventThrottle={64}
        onContentSizeChange={() => {
          if (followStream && stickToEnd) scrollRef.current?.scrollToEnd({ animated: false });
        }}
      >
        <Text style={[styles.text, dimmed && styles.textDimmed]}>{text}</Text>
      </ScrollView>
      {pending ? <ThinkingDots /> : null}
      {tone === 'error' && onRetry ? (
        <Pressable onPress={onRetry} style={styles.retryBtn} accessibilityRole="button">
          <Text style={styles.retryText}>再试一次</Text>
        </Pressable>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bubble: {
    borderWidth: 2,
    borderRadius: 4,
    backgroundColor: '#FFFDF7',
    paddingHorizontal: 14,
    paddingVertical: 10,
    shadowColor: '#3D3229',
    shadowOffset: { width: 2, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 0,
    elevation: 2,
  },
  dimmed: { opacity: 0.55 },
  errorBg: { backgroundColor: '#FBEFEC' },
  namePlate: {
    alignSelf: 'flex-start',
    backgroundColor: '#3D3229',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 3,
    marginBottom: 6,
  },
  namePlateText: { color: '#FAF6EC', fontSize: 12, fontWeight: '700' },
  text: { fontSize: 16, lineHeight: 24, color: '#3D3229' },
  textDimmed: { fontSize: 13, lineHeight: 19 },
  dots: { marginTop: 4, fontSize: 10, color: '#8A8377', letterSpacing: 2 },
  retryBtn: {
    marginTop: 8,
    alignSelf: 'flex-start',
    borderWidth: 2,
    borderColor: '#B3402F',
    borderRadius: 4,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  retryText: { color: '#B3402F', fontWeight: '700', fontSize: 13 },
});
