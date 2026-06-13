import { BottomTabBar, createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import {
  getFocusedRouteNameFromRoute,
  type NavigatorScreenParams,
} from '@react-navigation/native';
import { useEffect } from 'react';
import { Platform, StyleSheet, Text } from 'react-native';
import { prefetchBrainSnapshot } from '../brain/useBrainSnapshot';
import type { BrainStackParamList, GroupStackParamList } from './types';
import { GroupStack } from './GroupStack';
import { BrainStack } from './BrainStack';
import { zh } from '../locales/zh-CN';
import { brainTokens } from '../theme/brainTokens';
import { colors } from '../theme/colors';
import { wechat } from '../theme/wechat';
import { DogTabIcon, StudioTabIcon } from '../components/TabBarIcon';

export type RootTabParamList = {
  StudioTab: NavigatorScreenParams<GroupStackParamList> | undefined;
  BrainTab: NavigatorScreenParams<BrainStackParamList> | undefined;
};

const Tab = createBottomTabNavigator<RootTabParamList>();

// 每个 tab 的根屏名;进入子页时 tab bar 整体从 tree 移除(return null),
// 彻底消除空位 —— display:none 方案在 RN v7 中 onLayout 不触发导致高度残留。
const TAB_ROOTS: Record<string, string> = {
  StudioTab: 'GroupList',
  BrainTab: 'BrainHub',
};

function TabLabel({
  label,
  focused,
  brain,
}: {
  label: string;
  focused: boolean;
  brain: boolean;
}) {
  return (
    <Text
      style={[
        styles.tabLabel,
        brain
          ? focused
            ? styles.tabLabelBrainFocused
            : styles.tabLabelBrain
          : focused
            ? styles.tabLabelStudioFocused
            : styles.tabLabelStudio,
      ]}
    >
      {label}
    </Text>
  );
}

export function RootTabs() {
  // 用户登录后立即后台预取 BrainHub 数据,消除首次进入时的闪烁。
  useEffect(() => { prefetchBrainSnapshot(); }, []);

  return (
    <Tab.Navigator
      screenOptions={{ headerShown: false }}
      tabBar={(props) => {
        const active = props.state.routes[props.state.index];
        const focused = getFocusedRouteNameFromRoute(active);
        const root = TAB_ROOTS[active.name];
        // 非根屏:从 React tree 移除 tab bar,不留任何高度空位
        if (focused && focused !== root) return null;
        return <BottomTabBar {...props} />;
      }}
    >
      <Tab.Screen
        name="StudioTab"
        component={GroupStack}
        options={{
          tabBarLabel: ({ focused }) => (
            <TabLabel label={zh.tabs.studio} focused={focused} brain={false} />
          ),
          tabBarIcon: ({ color, focused }) => <StudioTabIcon color={color} focused={focused} />,
          tabBarActiveTintColor: colors.primary,
          tabBarInactiveTintColor: wechat.textSecondary,
          tabBarStyle: [styles.tabBar, styles.tabBarStudio],
        }}
      />
      <Tab.Screen
        name="BrainTab"
        component={BrainStack}
        options={{
          tabBarLabel: ({ focused }) => (
            <TabLabel label={zh.tabs.brain} focused={focused} brain />
          ),
          tabBarIcon: ({ color, focused }) => <DogTabIcon color={color} focused={focused} />,
          tabBarActiveTintColor: brainTokens.accent,
          tabBarInactiveTintColor: brainTokens.textMuted,
          tabBarStyle: [styles.tabBar, styles.tabBarBrain],
        }}
      />
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 4,
    height: Platform.OS === 'ios' ? 88 : 64,
  },
  tabBarStudio: {
    backgroundColor: wechat.navBg,
    borderTopColor: wechat.separator,
  },
  tabBarBrain: {
    backgroundColor: brainTokens.tabBarBg,
    borderTopColor: brainTokens.borderSubtle,
  },
  tabLabel: { fontSize: 11, marginTop: 2 },
  tabLabelStudio: { color: wechat.textSecondary },
  tabLabelStudioFocused: { color: colors.primary, fontWeight: '600' },
  tabLabelBrain: { color: brainTokens.textMuted },
  tabLabelBrainFocused: { color: brainTokens.accent, fontWeight: '700' },
});
