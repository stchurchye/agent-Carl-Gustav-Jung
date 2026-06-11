import React, { type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

type Props = {
  label: string;
  value?: string;
  /** 左侧小图标位(像素小图/Sprite),可空 */
  icon?: ReactNode;
  onPress?: () => void;
  destructive?: boolean;
  testID?: string;
};

/**
 * 设置页"一行一个"像素卡片行:独立白卡 + 2px 深描边 + 硬角。
 * 与 WeChatListCell 是两套视觉语言,别互改(后者被十几个子屏共用)。
 */
export function PixelListCell({ label, value, icon, onPress, destructive, testID }: Props) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.cell, pressed && styles.pressed]}
      accessibilityRole="button"
      testID={testID}
    >
      {icon ? <View style={styles.icon}>{icon}</View> : null}
      <Text
        style={[styles.label, !value && styles.labelGrow, destructive && styles.destructive]}
        numberOfLines={1}
      >
        {label}
      </Text>
      {value ? (
        <Text style={styles.value} numberOfLines={1}>
          {value}
        </Text>
      ) : null}
      {destructive ? null : <Text style={styles.chevron}>›</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  cell: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 60,
    backgroundColor: '#FFFDF7',
    borderWidth: 2,
    borderColor: '#3D3229',
    borderRadius: 4,
    paddingHorizontal: 14,
    marginBottom: 10,
    shadowColor: '#3D3229',
    shadowOffset: { width: 2, height: 2 },
    shadowOpacity: 0.16,
    shadowRadius: 0,
    elevation: 2,
  },
  pressed: { backgroundColor: '#F4EFE4' },
  icon: { marginRight: 10 },
  label: { fontSize: 16, fontWeight: '600', color: '#3D3229', flexShrink: 1 },
  labelGrow: { flex: 1 },
  destructive: { color: '#B3402F', flex: 1, textAlign: 'center' },
  value: { flex: 1, textAlign: 'right', fontSize: 14, color: '#8A8377', marginLeft: 10 },
  chevron: { fontSize: 20, color: '#B5AC9C', marginLeft: 8, fontWeight: '600' },
});
