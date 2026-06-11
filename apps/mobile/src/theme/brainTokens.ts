/**
 * 流浪猫大脑子系统的令牌源 —— U7 对齐 Claude 暖调(原微信亮色,更早是暗色 EVA)。
 * 键名沿用以保下游调用点稳定;accent 与全局 colors.primary 同为赤陶,
 * 消除「工作室绿 / 大脑橙」双 accent 分裂。仅颜色值,`as const` 保字面量类型。
 */
export const brainTokens = {
  bg: '#FFFFFF', // 主背景
  bgElevated: '#FAF9F5', // 抬升面(象牙)
  bgCard: '#FFFFFF', // 卡片(靠 border 分隔)
  tabBarBg: '#FAF9F5',
  accent: '#C15F3C', // 赤陶 accent(白底可读的大字/填充)
  accentBright: '#C15F3C', // 历史别名:同 accent
  accentDim: '#F7E0D3', // 语义反转:深→浅(调用点均背景用途)
  info: '#576B95', // 链接蓝(浅底可读)
  error: '#C0392B', // 错误(可读深红,与全局 danger 一致)
  text: '#1F1E1D', // 暖炭主文字
  textMuted: '#6E6B64', // 次文字
  textDim: '#A8A69E', // 弱文字
  border: '#EAE8DF',
  borderSubtle: 'rgba(234, 232, 223, 0.6)',
  mono: 'Menlo',
} as const;
