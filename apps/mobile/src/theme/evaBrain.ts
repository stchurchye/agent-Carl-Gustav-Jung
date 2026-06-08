/**
 * 流浪猫大脑主题 —— 已统一到微信亮色令牌（原暗色 EVA 观测台退役）。
 * 本文件为**亮色垫片**：键名保持不变（下游 25+ 引用零改动即点亮），仅改值映射到微信亮色。
 * 后续 P1 把调用点机械迁到 brainTokens 后，本文件物理删除。
 */
export const evaBrain = {
  bg: '#FFFFFF', // 主背景
  bgElevated: '#F7F7F7', // 抬升面
  bgCard: '#FFFFFF', // 卡片（靠 border 分隔）
  tabBarBg: '#F7F7F7',
  accent: '#E07B00', // EVA 橙调深以适配白底（品牌强调保留）
  accentBright: '#E07B00', // 亮橙在白底不可读 → 收深
  accentDim: '#FFE8CC', // 语义反转：深→浅（实测调用点均背景用途）
  info: '#576B95', // 微信链接蓝
  error: '#FA5151', // 微信红
  text: '#191919', // 主文字
  textMuted: '#888888', // 次文字
  textDim: '#B2B2B2', // 弱文字
  border: '#E5E5E5',
  borderSubtle: 'rgba(229, 229, 229, 0.6)',
  mono: 'Menlo',
} as const;
