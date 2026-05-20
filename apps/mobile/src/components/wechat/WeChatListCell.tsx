import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { wechatListStyles } from '../../theme/wechatList';

type Props = {
  label: string;
  value?: string;
  showChevron?: boolean;
  showSeparator?: boolean;
  separatorInset?: 'default' | 'avatar';
  onPress?: () => void;
  disabled?: boolean;
  right?: ReactNode;
  switchValue?: boolean;
  onSwitchChange?: (v: boolean) => void;
  destructive?: boolean;
};

export function WeChatListCell({
  label,
  value,
  showChevron,
  showSeparator = true,
  separatorInset = 'default',
  onPress,
  disabled,
  right,
  switchValue,
  onSwitchChange,
  destructive,
}: Props) {
  const chevron =
    showChevron ??
    (Boolean(onPress) && !right && switchValue === undefined);

  const labelStyle = destructive
    ? [wechatListStyles.cellLabel, styles.destructive]
    : wechatListStyles.cellLabel;

  const content = (
    <>
      <View style={[wechatListStyles.cell, styles.rowInner]}>
        <Text style={labelStyle} numberOfLines={2}>
          {label}
        </Text>
        {value ? (
          <Text style={wechatListStyles.cellValue} numberOfLines={1}>
            {value}
          </Text>
        ) : null}
        {right}
        {switchValue !== undefined && onSwitchChange ? (
          <Switch value={switchValue} onValueChange={onSwitchChange} />
        ) : null}
        {chevron && !right && switchValue === undefined ? (
          <Text style={wechatListStyles.cellChevron}>›</Text>
        ) : null}
      </View>
      {showSeparator ? (
        <View
          style={[
            wechatListStyles.separator,
            separatorInset === 'avatar' && wechatListStyles.separatorInsetAvatar,
          ]}
        />
      ) : null}
    </>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        disabled={disabled}
        style={({ pressed }) => [pressed && styles.pressed]}
        accessibilityRole="button"
      >
        {content}
      </Pressable>
    );
  }

  return <View>{content}</View>;
}

const styles = StyleSheet.create({
  rowInner: {
    paddingVertical: 0,
    minHeight: 56,
  },
  pressed: { opacity: 0.65 },
  destructive: { color: '#E64340' },
});
