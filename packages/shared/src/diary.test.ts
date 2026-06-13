import { describe, it, expect } from 'vitest';
import {
  isValidDiaryDayKey,
  DIARY_SCOPES,
  DIARY_STATUSES,
  type DiaryScope,
  type DiaryStatus,
} from './diary.js';

describe('isValidDiaryDayKey', () => {
  it('接受真实存在的日历日', () => {
    expect(isValidDiaryDayKey('2026-06-13')).toBe(true);
    expect(isValidDiaryDayKey('2024-02-29')).toBe(true); // 闰年
  });

  it('拒绝格式不符', () => {
    expect(isValidDiaryDayKey('2026-6-3')).toBe(false);
    expect(isValidDiaryDayKey('2026/06/13')).toBe(false);
    expect(isValidDiaryDayKey('06-13-2026')).toBe(false);
    expect(isValidDiaryDayKey('')).toBe(false);
  });

  it('拒绝格式对但不存在的日历日', () => {
    expect(isValidDiaryDayKey('2026-13-45')).toBe(false); // 月、日都越界
    expect(isValidDiaryDayKey('2026-00-00')).toBe(false);
    expect(isValidDiaryDayKey('2026-02-30')).toBe(false); // 2 月没有 30 号
    expect(isValidDiaryDayKey('2026-02-29')).toBe(false); // 非闰年
    expect(isValidDiaryDayKey('2026-04-31')).toBe(false); // 4 月只有 30 天
  });
});

describe('DIARY_SCOPES / DIARY_STATUSES 常量与类型同源', () => {
  it('scope 常量齐全', () => {
    expect(DIARY_SCOPES).toEqual(['self', 'group']);
  });

  it('status 常量齐全', () => {
    expect(DIARY_STATUSES).toEqual(['draft', 'confirmed', 'distilled']);
  });

  it('类型由常量派生(编译期 + 运行期一致)', () => {
    const scope: DiaryScope = 'group';
    const status: DiaryStatus = 'distilled';
    expect(DIARY_SCOPES).toContain(scope);
    expect(DIARY_STATUSES).toContain(status);
  });
});
