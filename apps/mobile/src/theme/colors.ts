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
