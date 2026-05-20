import { useWindowDimensions } from 'react-native';
import { typography } from './colors';

export const TABLET_MIN_WIDTH = 768;
export const GOLDEN_RATIO = 1.61803398875;

export function useLayout() {
  const { width, height } = useWindowDimensions();
  const isTablet = width >= TABLET_MIN_WIDTH;

  const titleFontSize = typography.title;
  const bodyFontSize = typography.body;
  const bodyLineHeight = typography.bodyLineHeight;
  const captionFontSize = typography.caption;
  const buttonFontSize = typography.button;
  const smallFontSize = typography.small;

  return {
    width,
    height,
    isTablet,
    contentMaxWidth: isTablet ? 720 : width,
    chatMaxWidth: isTablet ? 960 : width,
    pageMaxWidth: isTablet ? 1100 : width,
    horizontalPadding: isTablet ? 24 : 16,
    tabBarHeight: isTablet ? 56 : 50,
    titleFontSize,
    bodyFontSize,
    bodyLineHeight,
    replyLineHeight: Math.round(bodyFontSize * 1.4),
    captionFontSize,
    buttonFontSize,
    smallFontSize,
  };
}
