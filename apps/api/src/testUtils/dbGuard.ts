import { describe, it } from 'vitest';

/**
 * 测试两档分层(P0-S1):需要 PostgreSQL 的集成测试用 describeDb/itDb 声明。
 * - 无 DATABASE_URL:整组 skip(显式计入 skipped,不再红、也不再静默假绿)
 * - 有 DATABASE_URL:行为与 describe/it 完全一致
 * 深验档入口:`npm run test:pg`(缺 DATABASE_URL 直接 fail-fast,防 CI 假绿)。
 */
export const hasDb = Boolean(process.env.DATABASE_URL?.trim());

// describe.skip 的 ChainableFunction 类型与 SuiteAPI 不互赋,但调用形状一致 → 断言收口
export const describeDb = (hasDb ? describe : describe.skip) as typeof describe;
export const itDb = (hasDb ? it : it.skip) as typeof it;
