import { colors } from './colors';

// WCAG 相对亮度 + 对比度
function lum(hex: string): number {
  const h = hex.replace('#', '');
  const f = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const ch = [0, 2, 4].map((i) => {
    const v = parseInt(f.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
function contrast(a: string, b: string): number {
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

// 行为:状态/动作文字色落在各自浅底/白底上必须可读(WCAG AA 正文 4.5:1)。
// 防回归:link 曾误用 lily.leaf(#6a9b88,白底仅 ~2.9:1)。
it('status/action text colors stay readable on their light backgrounds (AA 4.5:1)', () => {
  const white = '#ffffff';
  const pairs: Array<[string, string, string]> = [
    ['link', colors.link, white],
    ['link', colors.link, colors.successBg],
    ['link', colors.link, colors.fill],
    // link 也用作填充按钮底(AskUser 提交 / Steer):守白字落 link 底的可读性,
    // 否则将来为链接文字调浅 link 会静默破坏按钮可读性。
    ['link-button(white-on-link)', colors.onPrimary, colors.link],
    ['info', colors.info, colors.infoBg],
    ['warning', colors.warning, colors.warningBg],
    ['danger', colors.danger, colors.errorBg],
  ];
  for (const [name, fg, bg] of pairs) {
    expect({ name, ratio: Math.round(contrast(fg, bg) * 100) / 100 }).toEqual({
      name,
      ratio: expect.any(Number),
    });
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
  }
});
