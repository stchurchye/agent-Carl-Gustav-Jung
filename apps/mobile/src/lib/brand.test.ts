import {
  ASSISTANT_FALLBACK_NAME,
  BRAND_NAME,
  DEFAULT_SESSION_TITLE,
  NETWORK_UNREACHABLE_PREFIX,
  isDefaultSessionTitle,
} from './brand';

describe('brand 品牌常量', () => {
  it('品牌名与角色兜底名', () => {
    expect(BRAND_NAME).toBe('Bow Wow Know');
    expect(ASSISTANT_FALLBACK_NAME).toBe('Bow Wow');
    expect(DEFAULT_SESSION_TITLE).toBe('和 Bow Wow 聊聊');
    expect(NETWORK_UNREACHABLE_PREFIX).toBe('连不上 Bow Wow 服务');
  });
});

describe('isDefaultSessionTitle 新旧默认标题双串兼容', () => {
  it('新默认标题算默认', () => {
    expect(isDefaultSessionTitle('和 Bow Wow 聊聊')).toBe(true);
  });

  it('存量旧默认标题(数据库与服务端仍写旧串)也算默认', () => {
    expect(isDefaultSessionTitle('和小助手聊聊')).toBe(true);
    // Title Case 化之前服务端写入的句首式默认标题
    expect(isDefaultSessionTitle('和 Bow wow 聊聊')).toBe(true);
  });

  it('容忍首尾空白', () => {
    expect(isDefaultSessionTitle('  和小助手聊聊 ')).toBe(true);
    expect(isDefaultSessionTitle(' 和 Bow Wow 聊聊')).toBe(true);
  });

  it('自定义标题不算默认', () => {
    expect(isDefaultSessionTitle('给妈妈的生日计划')).toBe(false);
  });

  it('空值不算默认标题(标题缺失由调用方自行兜底)', () => {
    expect(isDefaultSessionTitle('')).toBe(false);
    expect(isDefaultSessionTitle(undefined)).toBe(false);
    expect(isDefaultSessionTitle(null)).toBe(false);
  });
});
