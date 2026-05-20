import { describe, expect, it } from 'vitest';
import { isActionRequest } from './actionGate.js';

describe('isActionRequest', () => {
  it('detects slash commands', () => {
    expect(isActionRequest('/性格')).toBe(true);
  });

  it('ignores plain chat', () => {
    expect(isActionRequest('你好呀')).toBe(false);
  });

  it('detects colloquial settings phrasing', () => {
    expect(isActionRequest('说话能不能别那么冲')).toBe(true);
  });

  it('detects bare studio settings command', () => {
    expect(isActionRequest('设置')).toBe(true);
    expect(isActionRequest('打开设置')).toBe(true);
    expect(isActionRequest('/设置')).toBe(true);
  });
});
