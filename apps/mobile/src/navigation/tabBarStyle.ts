import { Platform, StyleSheet } from 'react-native';
import { wechat } from '../theme/wechat';

/**
 * StudioTab 的常驻底部 tab 栏样式。独立成模块(不放 RootTabs)以断开
 * RootTabs → GroupStack → ChatScreen → useHideTabBar → RootTabs 的 require 环。
 */
export const STUDIO_TAB_BAR_STYLE = StyleSheet.create({
  bar: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 4,
    height: Platform.OS === 'ios' ? 88 : 64,
    backgroundColor: wechat.navBg,
    borderTopColor: wechat.separator,
  },
}).bar;
