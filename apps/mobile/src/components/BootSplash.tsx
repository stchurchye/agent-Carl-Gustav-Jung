import { Image, StyleSheet, Text, View } from 'react-native';
import { brainTokens } from '../theme/brainTokens';

/**
 * JS 启动加载页。中间用桌面 launcher 图标的狗(splash-logo.png = icon.png 但背景已重映射成
 * 奶油 #F4EFE4),与原生 SplashScreen.storyboard 同一张图、同样 120pt，确保「原生 splash →
 * JS 加载页」视觉无缝,不再白屏/空黄屏分段,也不会露出比奶油底偏冷的图标方块。
 */
export function BootSplash() {
  return (
    <View style={styles.page}>
      <View style={styles.content}>
        <Image
          source={require('../../assets/splash-logo.png')}
          style={styles.logo}
          resizeMode="contain"
        />
        <Text style={styles.appName}>bow wow</Text>
        <Text style={styles.tagline}>know everything you told</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: '#F4EFE4', // 与 native splash backgroundColor 一致，切换无色差
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    alignItems: 'center',
    gap: 0,
  },
  logo: {
    width: 120,
    height: 120,
    marginBottom: 24,
  },
  appName: {
    fontSize: 32,
    fontWeight: '800',
    color: brainTokens.accent,
    letterSpacing: -0.5,
    marginBottom: 8,
  },
  tagline: {
    fontSize: 14,
    fontWeight: '400',
    color: '#8A8070',
    letterSpacing: 0.3,
  },
});
