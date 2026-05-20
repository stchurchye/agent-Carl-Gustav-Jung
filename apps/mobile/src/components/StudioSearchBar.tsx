import { Pressable, StyleSheet, Text, View } from 'react-native';
import { wechatChat } from '../theme/wechatChat';
import { zh } from '../locales/zh-CN';

type Props = {
  onPress: () => void;
};

/** 工作室列表顶部的微信式搜索入口（仅展示，点击进入搜索页） */
export function StudioSearchBar({ onPress }: Props) {
  return (
    <View style={styles.wrap}>
      <Pressable
        style={styles.bar}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={zh.studio.searchPlaceholder}
      >
        <Text style={styles.icon} accessibilityElementsHidden>
          ⌕
        </Text>
        <Text style={styles.placeholder}>{zh.studio.searchPlaceholder}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 6,
    backgroundColor: wechatChat.navBg,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 36,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 10,
    gap: 6,
  },
  icon: {
    fontSize: 18,
    lineHeight: 20,
    color: '#B2B2B2',
    fontWeight: '400',
  },
  placeholder: {
    flex: 1,
    fontSize: 15,
    color: '#B2B2B2',
  },
});
