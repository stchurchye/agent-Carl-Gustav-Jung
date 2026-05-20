import type { NavigationProp, ParamListBase } from '@react-navigation/native';
import type { BrainStackParamList } from '../navigation/types';

type TabNav = NavigationProp<ParamListBase> & {
  navigate: (name: string, params?: object) => void;
};

/** 从工作室栈跳转到流浪猫大脑子页 */
export function navigateBrainTab(
  navigation: NavigationProp<ParamListBase>,
  screen: keyof BrainStackParamList,
  params?: BrainStackParamList[keyof BrainStackParamList],
) {
  const parent = navigation.getParent() as TabNav | undefined;
  parent?.navigate('BrainTab', { screen, params });
}
