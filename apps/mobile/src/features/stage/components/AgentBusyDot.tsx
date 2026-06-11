import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text } from 'react-native';
import { useAgentRunPoll } from '../../agent/hooks/useAgentRunPoll';
import { isTerminalRunStatus } from '../../agent/types';

/**
 * 非当前说话者的狗在后台跑任务时,头顶的迷你状态点(呼吸闪烁)。
 * 订阅下沉到叶子(runStore 共享 long-poll);终态/missing 自动消失。
 */
export function AgentBusyDot({ runId, testID }: { runId: string; testID?: string }) {
  const snap = useAgentRunPoll(runId);
  const opacity = useRef(new Animated.Value(0.4)).current;
  const active = !!snap.run && !isTerminalRunStatus(snap.run.status) && !snap.missing;

  useEffect(() => {
    if (!active) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 600, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.4, duration: 600, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [active, opacity]);

  if (!active) return null;
  return (
    <Animated.View style={[styles.dot, { opacity }]} testID={testID}>
      <Text style={styles.txt}>⚒</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  dot: {
    position: 'absolute',
    top: 2,
    left: 0,
    width: 18,
    height: 18,
    borderRadius: 3,
    borderWidth: 2,
    borderColor: '#3D3229',
    backgroundColor: '#C6BFB3',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  txt: { fontSize: 10, color: '#3D3229', fontWeight: '700' },
});
