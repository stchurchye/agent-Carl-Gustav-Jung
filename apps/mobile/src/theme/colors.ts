import { wechat } from './wechat';

/**
 * Claude 暖调品牌色板(U7,参考 Claude Code 新版设计语言)。
 * 原莫奈双色系(lily 蓝绿/sunrise 橙粉,theme/monet.ts)随本次换肤退役删除。
 * 对比度承诺见 colors.contrast.test.ts:正文/动作文字落各自浅底 ≥4.5:1;
 * crail 品牌橙只用于填充/图标/选中态,不作正文。
 */
const claude = {
  oat: '#F0EEE6', // 暖燕麦:assistant 面/中性暖底
  crail: '#D97757', // 品牌橙(白底 3.1:1,禁作正文)
  terracotta: '#C15F3C', // 主动作填充(白字 4.2,按钮/大字)
  terracottaDeep: '#A1502F', // 链接/动作文字 + 白字钮底(双向 ≥4.5)
  terracottaTint: '#F6E3D7', // 赤陶浅调:软强调底
  bubble: '#F1E0D4', // 自己的气泡底
  olive: '#5A7340', // success 文字(白底 5.3)
  oliveBg: '#EEF1E6',
  errorRed: '#B3542F', // error 作正文可读(白底 4.97)
} as const;

export const colors = {
  background: wechat.pageBg,
  surface: wechat.cellBg,
  text: wechat.textPrimary,
  textMuted: wechat.textSecondary,
  primary: claude.terracotta,
  primarySoft: claude.terracottaTint,
  assistantBg: claude.oat,
  onPrimary: '#ffffff',
  backdrop: 'rgba(0, 0, 0, 0.4)',
  primaryBorder: '#E8C8B8',
  primaryMutedText: claude.terracottaDeep,
  insertBg: '#dff5e4',
  insertBorder: '#66bb6a',
  insertText: '#1b5e20',
  deleteBg: '#fdecea',
  deleteBorder: '#ef9a9a',
  deleteText: '#b71c1c',
  border: wechat.separator,
  tabInactive: wechat.textSecondary,
  waiting: claude.terracottaTint,
  error: claude.errorRed,
  success: claude.olive,
  userBubble: claude.bubble,
  accent: claude.crail,

  // —— P0.1 状态/语义令牌(agent 屏散色收敛;全部复用品牌调色板)——
  textTertiary: wechat.textTertiary, // 弱/禁用文字(收敛 #bbb)
  link: '#A1502F', // 可点动作/链接:深赤陶(文字与白字钮底双向 ≥4.5;原 #2e7d5b 品牌绿)
  fill: '#F2F0E9', // 中性填充:按压/禁用/代码块底(暖灰,原 #f4f4f4)
  selectedBg: '#F7EBE2', // 选中项/运行中卡底(赤陶浅调,原 lily.mist)
  info: '#576b95', // 信息文字(浅底可读)
  infoBg: '#eaf1f8', // 信息横幅底
  warning: '#8f6000', // 警示文字:可读深琥珀(浅底 AA 4.5:1)
  warningBg: '#fbf3e2', // 警示横幅底
  danger: '#c0392b', // 危险/错误文字:可读深红(区别于柔和的 error)
  successBg: claude.oliveBg, // 成功/产物卡底
  errorBg: '#fceeee', // 错误横幅底
  // U9:消息定位/长期记忆高亮闪烁底(原各屏散写 rgba(255,152,0,.14)/rgba(224,123,0,.15))
  messageHighlight: 'rgba(217, 119, 87, 0.16)',
  // accent(#D97757=rgb(217,119,87)) 的弱底展开:问 AI 输入框等软强调面
  accentSoftBg: 'rgba(217, 119, 87, 0.07)',
};

/** 微信式字号尺度 */
export const typography = {
  nav: 17,
  body: 16,
  bodyLineHeight: 22,
  title: 17,
  caption: 14,
  button: 16,
  small: 12,
  listSubtitleLineHeight: 20,
};
