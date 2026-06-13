import { describe, it, expect } from 'vitest';
import { diaryPromptForDialect, formatDiaryTranscript } from './diary.js';

describe('diaryPromptForDialect', () => {
  it('个人篇与群篇主语不同,都要求第一人称日记', () => {
    const self = diaryPromptForDialect('self');
    const group = diaryPromptForDialect('group');
    expect(self).toContain('日记');
    expect(self).toContain('第一人称');
    expect(group).toContain('群');
    expect(self).not.toBe(group);
  });
});

describe('formatDiaryTranscript', () => {
  it('speaker:content 拼接,空内容行剔除', () => {
    const t = formatDiaryTranscript([
      { speaker: '我', content: '今天好累' },
      { speaker: '旺财', content: '  抱抱  ' },
      { speaker: '我', content: '   ' }, // 空 → 剔除
    ]);
    expect(t).toBe('我：今天好累\n\n旺财：抱抱');
  });
});
