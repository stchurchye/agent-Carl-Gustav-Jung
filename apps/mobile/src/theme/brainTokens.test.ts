import { brainTokens } from './brainTokens';

// 行为:brainTokens 是大脑子系统的统一令牌源(EVA 暗色已退役;U7 起对齐
// Claude 暖调:象牙抬升面 + 赤陶 accent,全 app 单 accent)。锁住承重值防回退。
it('exposes the unified Claude-warm tokens (light page bg, terracotta accent)', () => {
  expect(brainTokens.bg).toBe('#FFFFFF'); // 页面浅底
  expect(brainTokens.bgCard).toBe('#FFFFFF');
  expect(brainTokens.text).toBe('#1F1E1D'); // 暖炭主文字
  expect(brainTokens.accent).toBe('#C15F3C'); // 赤陶 accent(与全局 primary 一致)
});
