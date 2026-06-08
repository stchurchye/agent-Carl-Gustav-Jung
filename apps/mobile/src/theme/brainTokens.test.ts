import { brainTokens } from './brainTokens';

// 行为:brainTokens 是大脑子系统统一后的微信亮色令牌源(EVA 暗色已退役)。
// 锁住几个承重值,防回退暗色。
it('exposes the unified WeChat light tokens (light page bg, brand orange accent)', () => {
  expect(brainTokens.bg).toBe('#FFFFFF'); // 页面浅底
  expect(brainTokens.bgCard).toBe('#FFFFFF');
  expect(brainTokens.text).toBe('#191919'); // 深色主文字
  expect(brainTokens.accent).toBe('#E07B00'); // 品牌橙(白底可读)
});
