import { localDayKey, localDayWindow } from './diaryDay';

describe('localDayKey', () => {
  it('按本地时区取 YYYY-MM-DD(用本地构造的 Date,与时区无关地稳定)', () => {
    expect(localDayKey(new Date(2026, 5, 20, 15, 30, 0))).toBe('2026-06-20'); // 6 月=index 5
    expect(localDayKey(new Date(2026, 0, 9, 0, 0, 0))).toBe('2026-01-09'); // 补零
  });
});

describe('localDayWindow', () => {
  it('start=本地当日午夜、end=次日本地午夜(本地分量稳定,不受 test 时区影响)', () => {
    const { dayStartIso, dayEndIso } = localDayWindow('2026-06-20');
    const start = new Date(dayStartIso);
    const end = new Date(dayEndIso);
    // start 落在本地 6-20 午夜
    expect(localDayKey(start)).toBe('2026-06-20');
    expect(start.getHours()).toBe(0);
    expect(start.getMinutes()).toBe(0);
    // end 落在本地 6-21 午夜(半开区间上界)
    expect(localDayKey(end)).toBe('2026-06-21');
    expect(end.getHours()).toBe(0);
  });

  it('start < end', () => {
    const { dayStartIso, dayEndIso } = localDayWindow('2026-06-20');
    expect(Date.parse(dayStartIso)).toBeLessThan(Date.parse(dayEndIso));
  });

  it('跨月/跨年:end 正确滚到下一天(Date 溢出归一)', () => {
    const dec = localDayWindow('2026-12-31');
    expect(localDayKey(new Date(dec.dayEndIso))).toBe('2027-01-01'); // 跨年
    const jan = localDayWindow('2026-01-31');
    expect(localDayKey(new Date(jan.dayEndIso))).toBe('2026-02-01'); // 跨月
  });

  it('畸形 / 不存在的日历日 → 抛错(不静默算错)', () => {
    expect(() => localDayWindow('garbage')).toThrow();
    expect(() => localDayWindow('2026-13-45')).toThrow();
    expect(() => localDayWindow('2026-02-30')).toThrow();
  });
});
