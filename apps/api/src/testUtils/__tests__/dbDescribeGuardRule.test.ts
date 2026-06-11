import { describe, it } from 'vitest';
import { RuleTester } from 'eslint';
// @ts-expect-error 仓库自定义 eslint 规则是无类型的纯 JS 模块
import dbDescribeGuard from '../../../eslint-rules/db-describe-guard.js';

// RuleTester 默认找全局 describe/it;vitest 未开 globals,显式接线
RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
});

ruleTester.run('db-describe-guard', dbDescribeGuard, {
  valid: [
    {
      name: 'vi.mock db/client(factory 形式,如 tools.askUser.test.ts)→ plain describe 合法',
      code: `
        import { describe, it, vi } from 'vitest';
        vi.mock('../../../db/client.js', () => ({ getPool: () => ({ query: vi.fn() }) }));
        describe('ask_user tool', () => {});
      `,
    },
    {
      name: '静态 import + 同路径 vi.mock(hoisted)→ plain describe 合法',
      code: `
        import { vi } from 'vitest';
        import { getPool } from '../../../db/client.js';
        vi.mock('../../../db/client.js');
        describe('mocked suite', () => {});
      `,
    },
    {
      name: '真实 import + 顶层 describeDb → 合法(两档分层正确用法)',
      code: `
        import { describeDb } from '../../../testUtils/dbGuard.js';
        import { getPool } from '../../../db/client.js';
        describeDb('agent runtime end-to-end', () => {});
      `,
    },
    {
      name: 'describeDb 内嵌套 plain describe → 合法(外层已守门)',
      code: `
        import { describeDb } from '../../testUtils/dbGuard.js';
        import { getPool } from '../../db/client.js';
        describeDb('outer', () => {
          describe('inner group', () => {});
        });
      `,
    },
    {
      name: '不碰 db 的纯单测 → plain describe 合法',
      code: `
        import { describe, it, expect } from 'vitest';
        import { redact } from '../redact.js';
        describe('redact', () => {});
      `,
    },
    {
      name: '路径相似但非 PG 入口(db/clientFoo、other/client、migrateHelper)→ 不误伤',
      code: `
        import { a } from '../db/clientFoo.js';
        import { b } from '../other/client.js';
        import { c } from './migrateHelper.js';
        describe('lookalike paths', () => {});
      `,
    },
    {
      name: '混合文件(86fb54d 形态):纯逻辑块 plain describe + DB 块 describeDb → 全部放行',
      code: `
        import { describe, expect, it } from 'vitest';
        import { describeDb } from '../../../testUtils/dbGuard.js';
        import { runMigrations } from '../../../db/migrate.js';
        import { ensureUser } from './_groupFixture.js';
        describe('buildCheckpoint (mechanical)', () => {});
        describeDb('context_checkpoint column round-trip', () => {});
      `,
    },
    {
      name: '真实 import + 顶层 itDb(无 describe 包裹)→ 已参与分层,放行',
      code: `
        import { itDb } from '../../testUtils/dbGuard.js';
        import { getPool } from '../../db/client.js';
        describe('suite with guarded tests', () => {
          itDb('hits pg', async () => {});
        });
      `,
    },
    {
      name: '真实 import + describe.skip → 放过(本来就不执行)',
      code: `
        import { getPool } from '../../db/client.js';
        describe.skip('quarantined suite', () => {});
      `,
    },
  ],
  invalid: [
    {
      name: '真实 import db/client + 顶层 describe → 报错',
      code: `
        import { getPool } from '../../../db/client.js';
        describe('my suite', () => {});
      `,
      errors: [{ messageId: 'useDescribeDb' }],
    },
    {
      name: 'import db/migrate.js(runMigrations)+ 顶层 describe → 报错',
      code: `
        import { runMigrations } from '../../../db/migrate.js';
        describe('migration suite', () => {});
      `,
      errors: [{ messageId: 'useDescribeDb' }],
    },
    {
      name: 'import _groupFixture.js(ensureUser 真连 PG)+ 顶层 describe → 报错',
      code: `
        import { ensureUser, ensureGroup } from './_groupFixture.js';
        describe('group suite', () => {});
      `,
      errors: [{ messageId: 'useDescribeDb' }],
    },
    {
      name: '动态 import db/client(无 vi.mock)+ 顶层 describe → 报错',
      code: `
        describe('runtime', () => {
          it('reads pool lazily', async () => {
            const { getPool } = await import('../../../db/client.js');
            await getPool().query('SELECT 1');
          });
        });
      `,
      errors: [{ messageId: 'useDescribeDb' }],
    },
    {
      name: '真实 import + describe.only → 报错(only 也会真跑)',
      code: `
        import { getPool } from '../../db/client.js';
        describe.only('focused suite', () => {});
      `,
      errors: [{ messageId: 'useDescribeDb' }],
    },
    {
      name: '真实 import + describe.each(...)(...) → 报错',
      code: `
        import { getPool } from '../../db/client.js';
        describe.each([1, 2])('suite %i', (n) => {});
      `,
      errors: [{ messageId: 'useDescribeDb' }],
    },
    {
      name: '多个顶层 describe → 每个都报',
      code: `
        import { getPool } from '../../db/client.js';
        describe('suite a', () => {});
        describe('suite b', () => {});
      `,
      errors: [{ messageId: 'useDescribeDb' }, { messageId: 'useDescribeDb' }],
    },
  ],
});
