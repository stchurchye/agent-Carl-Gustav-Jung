import { brainTokens } from './brainTokens';
import { evaBrain } from './evaBrain';

// 行为:brainTokens 是大脑子系统的稳定令牌锚点,桥接到已统一的微信亮色源。
// P1 调用点将从 evaBrain 机械迁到 brainTokens;迁移期两者必须同源同值。
it('bridges to the unified light tokens (same reference, light page bg)', () => {
  // 同引用 re-export(非 spread)—— 保住 as-const 字面量类型,下游 union 不退化为 string。
  expect(brainTokens).toBe(evaBrain);
  expect(brainTokens.bg).toBe('#FFFFFF');
});
