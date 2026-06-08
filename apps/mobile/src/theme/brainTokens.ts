/**
 * 流浪猫大脑子系统的**稳定令牌锚点**。
 * 当前桥接到亮色垫片 evaBrain(同引用 re-export,非 spread —— 保住 as-const 字面量类型,
 * 下游 union 不退化为 string)。P1 把调用点机械迁到本模块后,P1.6 删 evaBrain.ts 时
 * 把字面量内联到这里(仍保 `as const`)。
 */
import { evaBrain } from './evaBrain';

export const brainTokens = evaBrain;
