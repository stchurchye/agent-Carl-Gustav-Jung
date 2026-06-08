/**
 * 流浪猫大脑子系统的令牌源 —— 已统一到微信亮色。
 * 原暗色 EVA 观测台主题已退役删除;键名沿用以保下游调用点稳定。
 * 仅颜色值,`as const` 保字面量类型(下游 union 不退化为 string)。
 */
export const brainTokens = {
  bg: '#FFFFFF', // 主背景
  bgElevated: '#F7F7F7', // 抬升面
  bgCard: '#FFFFFF', // 卡片(靠 border 分隔)
  tabBarBg: '#F7F7F7',
  accent: '#E07B00', // 品牌橙(调深适配白底)
  accentBright: '#E07B00', // 亮橙在白底不可读 → 收深
  accentDim: '#FFE8CC', // 语义反转:深→浅(调用点均背景用途)
  info: '#576B95', // 微信链接蓝
  error: '#FA5151', // 微信红
  text: '#191919', // 主文字
  textMuted: '#888888', // 次文字
  textDim: '#B2B2B2', // 弱文字
  border: '#E5E5E5',
  borderSubtle: 'rgba(229, 229, 229, 0.6)',
  mono: 'Menlo',
} as const;
