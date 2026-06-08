import React, { useState } from 'react';
import { View, TextInput, TouchableOpacity, Text } from 'react-native';
import { colors } from '../../theme/colors';

type Props = {
  onSubmit: (text: string) => void;
  disabled?: boolean;
  placeholder?: string;
};

export function AgentSteerInput({ onSubmit, disabled, placeholder }: Props) {
  const [text, setText] = useState('');
  const canSubmit = !disabled && text.trim().length > 0;

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
        onPress={() => {
          if (!canSubmit) return;
          onSubmit(text.trim());
          setText('');
        }}
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
