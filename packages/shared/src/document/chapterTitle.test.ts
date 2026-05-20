import { describe, expect, it } from 'vitest';
import {
  buildChapterTitle,
  displayChapterTitle,
  parseChapterTitle,
} from './chapterTitle.js';
import { formatChapterTitle } from './formatChapterTitle.js';

describe('chapterTitle', () => {
  it('parses new type·index format', () => {
    expect(parseChapterTitle('段·2')).toEqual({ type: '段', index: '2', note: '' });
    expect(parseChapterTitle('章·3·童年')).toEqual({
      type: '章',
      index: '3',
      note: '童年',
    });
  });

  it('parses legacy 第X章', () => {
    expect(parseChapterTitle('第二章')).toEqual({ type: '章', index: '2', note: '' });
    expect(parseChapterTitle('第二章童年')).toEqual({
      type: '章',
      index: '2',
      note: '童年',
    });
  });

  it('parses plain number as default type + 序号', () => {
    expect(parseChapterTitle('1')).toEqual({ type: '会议记录', index: '1', note: '' });
    expect(parseChapterTitle('2·求学')).toEqual({
      type: '会议记录',
      index: '2',
      note: '求学',
    });
  });

  it('builds and displays', () => {
    const built = buildChapterTitle({ type: '节', index: '4', note: '尾声' });
    expect(built).toBe('节·4·尾声');
    expect(displayChapterTitle(built)).toBe('节 4 尾声');
  });

  it('formatChapterTitle uses type', () => {
    expect(formatChapterTitle(0, '章')).toBe('章·1');
    expect(formatChapterTitle(2)).toBe('会议记录·3');
  });
});
