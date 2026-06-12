import { useLayoutEffect } from 'react';
import { useNavigation, type NavigationProp, type ParamListBase } from '@react-navigation/native';
import { STUDIO_TAB_BAR_STYLE } from './tabBarStyle';

/**
 * 进对话前先把父 tab 栏 display:none。
 * 在 navigate() 之前调用,使对话屏首帧布局就已满高,
 * 彻底避免「tab 栏塌陷 → 聊天页重排」那一帧底部空白(单靠对话屏内 useHideTabBar 是挂载后才隐藏,会重排一次)。
 */
export function hideStudioTabBar(navigation: NavigationProp<ParamListBase>) {
  navigation.getParent()?.setOptions({ tabBarStyle: { display: 'none' } } as object);
}

/**
 * 进入对话页时隐藏底部 tab 栏(输入框直接贴屏底),离开时恢复。
 *
 * 用 useLayoutEffect 在本屏首帧绘制前就把父 tab 栏 display:none,
 * 比在 Tab 层用 getFocusedRouteNameFromRoute 反应式隐藏更早一拍,
 * 消除「滑入动画期间 tab 栏还在、结算后才抽走」的闪烁。
 */
export function useHideTabBar() {
  const navigation = useNavigation();
  useLayoutEffect(() => {
    // getParent 可能在测试 mock 或脱离 Tab 栈时缺失,可选链兜底
    const parent = navigation.getParent?.();
    parent?.setOptions({ tabBarStyle: { display: 'none' } });
    return () => parent?.setOptions({ tabBarStyle: STUDIO_TAB_BAR_STYLE });
  }, [navigation]);
}
