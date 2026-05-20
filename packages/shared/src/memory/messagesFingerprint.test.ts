import { describe, expect, it } from 'vitest';
import { messagesFingerprint } from './messagesFingerprint.js';

describe('messagesFingerprint', () => {
  it('includes length and last three message ids', () => {
    const msgs = [
      { id: 'a' },
      { id: 'b' },
      { id: 'c' },
      { id: 'd' },
    ];
    expect(messagesFingerprint(msgs)).toBe('4:b,c,d');
  });

  it('changes when tail ids change', () => {
    const a = messagesFingerprint([{ id: '1' }, { id: '2' }]);
    const b = messagesFingerprint([{ id: '1' }, { id: '3' }]);
    expect(a).not.toBe(b);
  });
});
