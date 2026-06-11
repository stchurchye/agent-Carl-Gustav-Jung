import React, { useRef, useState } from 'react';
import { View, TextInput, TouchableOpacity, Text } from 'react-native';
import { colors } from '../../theme/colors';

type Props = {
  onSubmit: (text: string) => void | Promise<void>;
  disabled?: boolean;
  placeholder?: string;
};

export function AgentSteerInput({ onSubmit, disabled, placeholder }: Props) {
  const [text, setText] = useState('');
  const [pending, setPending] = useState(false);
  // state 异步刷新堵不住同帧双击,用 ref 做同步守卫
  const pendingRef = useRef(false);
  const canSubmit = !disabled && !pending && text.trim().length > 0;

  const handlePress = async () => {
    if (!canSubmit || pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    const trimmed = text.trim();
    setText('');
    try {
      await onSubmit(trimmed);
    } catch {
      // 失败不丢用户输入:原文还给输入框(报错由父组件 Alert)
      setText((cur) => cur || trimmed);
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };

  return (
    <View style={{ flexDirection: 'row', marginTop: 8, alignItems: 'center' }}>
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder={placeholder ?? '发送指令调整 agent 行为…'}
        editable={!disabled}
        style={{
          flex: 1,
          borderWidth: 1,
          borderColor: colors.border,
          paddingHorizontal: 8,
          paddingVertical: 6,
          borderRadius: 6,
          backgroundColor: disabled ? colors.fill : colors.surface,
        }}
      />
      <TouchableOpacity
        disabled={!canSubmit}
        onPress={() => void handlePress()}
        style={{
          marginLeft: 6,
          paddingHorizontal: 12,
          paddingVertical: 8,
          backgroundColor: canSubmit ? colors.link : colors.textTertiary,
          borderRadius: 6,
        }}
      >
        <Text style={{ color: colors.onPrimary }}>steer</Text>
      </TouchableOpacity>
    </View>
  );
}
