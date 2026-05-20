import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import type { NavigatorScreenParams } from '@react-navigation/native';
import { Platform, StyleSheet, Text } from 'react-native';
import type { BrainStackParamList, GroupStackParamList } from './types';
import { GroupStack } from './GroupStack';
import { BrainStack } from './BrainStack';
import { zh } from '../locales/zh-CN';
import { evaBrain } from '../theme/evaBrain';
import { colors } from '../theme/colors';
import { wechat } from '../theme/wechat';

export type RootTabParamList = {
  StudioTab: NavigatorScreenParams<GroupStackParamList> | undefined;
  BrainTab: NavigatorScreenParams<BrainStackParamList> | undefined;
};

const Tab = createBottomTabNavigator<RootTabParamList>();

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
        options={{
          tabBarLabel: ({ focused }) => (
            <TabLabel label={zh.tabs.studio} focused={focused} brain={false} />
          ),
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
          tabBarActiveTintColor: evaBrain.accent,
          tabBarInactiveTintColor: evaBrain.textMuted,
          tabBarStyle: [styles.tabBar, styles.tabBarBrain],
        }}
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
  tabBarStudio: {
    backgroundColor: wechat.navBg,
    borderTopColor: wechat.separator,
  },
  tabBarBrain: {
    backgroundColor: evaBrain.tabBarBg,
    borderTopColor: evaBrain.borderSubtle,
  },
  tabLabel: { fontSize: 11, marginTop: 2 },
  tabLabelStudio: { color: wechat.textSecondary },
  tabLabelStudioFocused: { color: colors.primary, fontWeight: '600' },
  tabLabelBrain: { color: evaBrain.textMuted },
  tabLabelBrainFocused: { color: evaBrain.accent, fontWeight: '700' },
});
