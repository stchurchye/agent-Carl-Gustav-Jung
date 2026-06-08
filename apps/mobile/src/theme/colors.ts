import { lily, sunrise } from './monet';
import { wechat } from './wechat';

export const colors = {
  background: wechat.pageBg,
  surface: wechat.cellBg,
  text: wechat.textPrimary,
  textMuted: wechat.textSecondary,
  primary: lily.leaf,
  primarySoft: sunrise.glow,
  assistantBg: lily.mist,
  onPrimary: '#ffffff',
  backdrop: 'rgba(0, 0, 0, 0.4)',
  primaryBorder: lily.pool,
  primaryMutedText: lily.leaf,
  insertBg: '#dff5e4',
  insertBorder: '#66bb6a',
  insertText: '#1b5e20',
  deleteBg: '#fdecea',
  deleteBorder: '#ef9a9a',
  deleteText: '#b71c1c',
  border: wechat.separator,
  tabInactive: wechat.textSecondary,
  waiting: sunrise.glow,
  error: sunrise.coral,
  success: lily.leaf,
  userBubble: sunrise.peach,
  accent: sunrise.coral,

  // —— P0.1 状态/语义令牌(agent 屏散色收敛;全部复用品牌调色板)——
  textTertiary: wechat.textTertiary, // 弱/禁用文字(收敛 #bbb)
  link: '#2e7d5b', // 可点动作/链接:浅底可读的深品牌绿(原 #0a6 绿/#0a66c2 蓝;比 lily.leaf 深以保 4.5:1)
  fill: '#f4f4f4', // 中性填充:按压/禁用/代码块底
  selectedBg: lily.mist, // 选中项底(原 #eef4ff)
  info: '#576b95', // 信息文字(原 #055 青 → 微信链接蓝,浅底可读)
  infoBg: '#eaf1f8', // 信息横幅底(原 #e6f4ff)
  warning: '#8f6000', // 警示文字:可读深琥珀(原 #a60;加深至浅底 AA 4.5:1,不用 sunrise.gold)
  warningBg: '#fbf3e2', // 警示横幅底(原 #fff8e0 / #fff7e0)
  danger: '#c0392b', // 危险/错误文字:可读深红(原 #a00 / #c33;区别于柔和的 error=coral)
  successBg: lily.bg, // 成功/产物卡底(原绿色调 #f0f7f0;蓝调 #f0f7ff 走 infoBg)
  errorBg: '#fceeee', // 错误横幅底(原 #fff0f0)
};

/** 微信式字号尺度（保留 Monet 主色） */
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
