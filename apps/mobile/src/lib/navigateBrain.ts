import type { NavigationProp, ParamListBase } from '@react-navigation/native';
import type { BrainStackParamList } from '../navigation/types';

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
