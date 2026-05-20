import { describe, expect, it } from 'vitest';
import { previewMessageText } from './previewMessage.js';

describe('previewMessageText', () => {
  it('returns short text unchanged', () => {
    expect(previewMessageText('你好')).toBe('你好');
  });

  it('truncates with ellipsis beyond default limit', () => {
    const long = '测'.repeat(200);
    const out = previewMessageText(long);
    expect(out.endsWith('…')).toBe(true);
    expect([...out].length).toBeLessThanOrEqual(121);
  });
});
