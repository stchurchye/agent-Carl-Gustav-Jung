import type { NavigationProp, ParamListBase } from '@react-navigation/native';
import type { BrainStackParamList, GroupStackParamList } from '../navigation/types';

type TabNav = NavigationProp<ParamListBase> & {
  navigate: (name: string, params?: object) => void;
};

/**
 * 从工作室栈跳转到流浪猫大脑子页。
 * 泛型把 params 绑定到具体 screen —— 屏/参错配在 tsc 暴露(深链铁律 2 的类型防线)。
 */
export function navigateBrainTab<S extends keyof BrainStackParamList>(
  navigation: NavigationProp<ParamListBase>,
  screen: S,
  params?: BrainStackParamList[S],
) {
  const parent = navigation.getParent() as TabNav | undefined;
  parent?.navigate('BrainTab', { screen, params });
}

/** 反向:从 my bow wow(大脑栈)跳到工作室栈的子页(如设置/MeScreen)。 */
export function navigateStudioTab<S extends keyof GroupStackParamList>(
  navigation: NavigationProp<ParamListBase>,
  screen: S,
  params?: GroupStackParamList[S],
) {
  const parent = navigation.getParent() as TabNav | undefined;
  parent?.navigate('StudioTab', { screen, params });
}
