import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { wechatChat } from '../theme/wechatChat';
import { typography } from '../theme/colors';

type Props = {
  title: string;
  showBack?: boolean;
  onBack?: () => void;
  onTitlePress?: () => void;
  onTitleLongPress?: () => void;
  titleAccessory?: ReactNode;
  left?: ReactNode;
  right?: ReactNode;
};

export function WeChatChatHeader({
  title,
  showBack,
  onBack,
  onTitlePress,
  onTitleLongPress,
  titleAccessory,
  left,
  right,
}: Props) {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const titleEditable = Boolean(onTitlePress || onTitleLongPress);
  const handleTitlePress = onTitlePress ?? onTitleLongPress;

  const handleBack = () => {
    if (onBack) {
      onBack();
      return;
    }
    if (navigation.canGoBack()) navigation.goBack();
  };

  return (
    <View style={[styles.wrap, { paddingTop: insets.top }]}>
      <View style={styles.bar}>
        <View style={styles.side}>
          {showBack ? (
            <Pressable onPress={handleBack} hitSlop={12} style={styles.backBtn}>
              <Text style={styles.backIcon}>‹</Text>
            </Pressable>
          ) : (
            left
          )}
        </View>
        <View style={styles.titleSlot}>
          {titleEditable && handleTitlePress ? (
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={handleTitlePress}
              onLongPress={onTitleLongPress ?? onTitlePress}
              delayLongPress={520}
              accessibilityRole="button"
              accessibilityLabel={`${title}，点击编辑`}
            />
          ) : null}
          <Text style={styles.title} numberOfLines={1} pointerEvents="none">
            {title}
          </Text>
          {titleAccessory ? (
            <View pointerEvents="none">{titleAccessory}</View>
          ) : null}
        </View>
        <View style={[styles.side, styles.sideRight]}>{right}</View>
      </View>
    </View>
  );
}

const BAR_HEIGHT = 44;

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: wechatChat.navBg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: wechatChat.navBorder,
  },
  bar: {
    height: BAR_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  side: {
    minWidth: 72,
    flexShrink: 0,
    justifyContent: 'center',
  },
  sideRight: {
    alignItems: 'flex-end',
    maxWidth: 168,
  },
  backBtn: {
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  backIcon: {
    fontSize: 32,
    lineHeight: 34,
    fontWeight: '300',
    color: '#000000',
    marginTop: -2,
  },
  titleSlot: {
    flex: 1,
    minHeight: BAR_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    gap: 4,
    minWidth: 0,
  },
  title: {
    flexShrink: 1,
    textAlign: 'center',
    fontSize: typography.title,
    fontWeight: '600',
    color: '#000000',
    maxWidth: '100%',
  },
});
