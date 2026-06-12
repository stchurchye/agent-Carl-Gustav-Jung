import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import {
  getFocusedRouteNameFromRoute,
  type NavigatorScreenParams,
  type RouteProp,
} from '@react-navigation/native';
import { Platform, StyleSheet, Text } from 'react-native';
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

/**
 * 底部 tab 栏只在每个栈的「根屏」显示;进任何二级/三级页都隐藏。
 * getFocusedRouteNameFromRoute 在首屏返回 undefined → 视作根屏(显示)。
 */
function tabBarStyleForRoot(
  route: RouteProp<RootTabParamList>,
  rootRouteName: string,
  visibleStyle: object,
) {
  const focused = getFocusedRouteNameFromRoute(route) ?? rootRouteName;
  return focused === rootRouteName ? visibleStyle : styles.tabBarHidden;
}

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
  return (
    <Tab.Navigator screenOptions={{ headerShown: false }}>
      <Tab.Screen
        name="StudioTab"
        component={GroupStack}
        options={({ route }) => ({
          tabBarLabel: ({ focused }) => (
            <TabLabel label={zh.tabs.studio} focused={focused} brain={false} />
          ),
          tabBarIcon: ({ color, focused }) => <StudioTabIcon color={color} focused={focused} />,
          tabBarActiveTintColor: colors.primary,
          tabBarInactiveTintColor: wechat.textSecondary,
          // 只在工作室栈根(GroupList)显示;二级/三级页隐藏
          tabBarStyle: tabBarStyleForRoot(route, 'GroupList', [styles.tabBar, styles.tabBarStudio]),
        })}
      />
      <Tab.Screen
        name="BrainTab"
        component={BrainStack}
        options={({ route }) => ({
          tabBarLabel: ({ focused }) => (
            <TabLabel label={zh.tabs.brain} focused={focused} brain />
          ),
          tabBarIcon: ({ color, focused }) => <DogTabIcon color={color} focused={focused} />,
          tabBarActiveTintColor: brainTokens.accent,
          tabBarInactiveTintColor: brainTokens.textMuted,
          // 只在大脑栈根(BrainHub)显示;二级/三级页隐藏
          tabBarStyle: tabBarStyleForRoot(route, 'BrainHub', [styles.tabBar, styles.tabBarBrain]),
        })}
      />
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 4,
    height: Platform.OS === 'ios' ? 88 : 64,
  },
  tabBarHidden: { display: 'none' },
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
