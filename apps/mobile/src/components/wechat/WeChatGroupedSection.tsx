import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { wechatListStyles } from '../../theme/wechatList';

type Props = {
  title?: string;
  footer?: string;
  children: ReactNode;
};

export function WeChatGroupedSection({ title, footer, children }: Props) {
  return (
    <View style={wechatListStyles.groupWrap}>
      {title ? (
        <View style={wechatListStyles.groupHeader}>
          <Text style={wechatListStyles.groupHeaderText}>{title}</Text>
        </View>
      ) : null}
      <View style={wechatListStyles.groupCard}>{children}</View>
      {footer ? (
        <View style={wechatListStyles.footer}>
          <Text style={wechatListStyles.footerText}>{footer}</Text>
        </View>
      ) : null}
    </View>
  );
}

export function WeChatLogoutSection({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <View style={wechatListStyles.groupWrap}>
      <Pressable
        style={wechatListStyles.logoutCell}
        onPress={onPress}
        accessibilityRole="button"
      >
        <Text style={wechatListStyles.logoutText}>{label}</Text>
      </Pressable>
    </View>
  );
}
