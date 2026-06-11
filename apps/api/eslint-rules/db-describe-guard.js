/**
 * P0-S1 兜底:test 文件真连 PG 时必须用 describeDb(testUtils/dbGuard.ts)而非顶层 describe。
 *
 * Why:两档分层落地后,新增测试若直接顶层 describe 且真实 import db/client.js,
 * 无 DATABASE_URL 时整文件红、有 DB 时绕过分层(不计入 skipped 统计)。
 *
 * 检测规则:文件内出现对 PG 入口模块的真实 import(静态或动态,且没有对同路径的
 * vi.mock)→ 所有会执行的顶层 describe 调用报错,要求改用 describeDb。
 *
 * 豁免(合法的 plain describe):
 * - vi.mock('../../db/client.js', ...) 的文件(如 tools.askUser.test.ts)——mock 后不连 PG;
 * - 已使用 describeDb/itDb 的文件(86fb54d 形态:纯逻辑块 plain describe 与 DB 块
 *   describeDb 共存)——文件已参与分层,块级粒度交给 code review。
 *
 * Known limitation:间接 PG 入口只列了 _groupFixture;新 fixture 须自行加入 PG_ENTRY_RE。
 */

// 真连 PG 的入口模块:db/client(getPool)、db/migrate(runMigrations)、
// __tests__/_groupFixture(ensureUser/ensureGroup,内部 getPool)。相对深度无关,按后缀匹配。
const PG_ENTRY_RE = /(^|\/)(db\/(client|migrate)|_groupFixture)(\.js)?$/;

/**
 * 会真正执行套件的顶层 describe 调用形态:
 * - describe('x', fn)
 * - describe.only('x', fn) 等修饰(skip 除外——本来就不跑)
 * - describe.each(table)('x %i', fn)(外层 call 的 callee 是内层 CallExpression,递归)
 */
function isRunnableDescribe(callee) {
  if (callee.type === 'Identifier') return callee.name === 'describe';
  if (
    callee.type === 'MemberExpression' &&
    callee.object.type === 'Identifier' &&
    callee.object.name === 'describe' &&
    callee.property.type === 'Identifier' &&
    callee.property.name !== 'skip'
  ) {
    return true;
  }
  if (callee.type === 'CallExpression') return isRunnableDescribe(callee.callee);
  return false;
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description: '真实 import db/client.js 的测试文件必须用 describeDb 而非顶层 describe',
      category: 'Possible Errors',
      recommended: false,
    },
    schema: [],
    messages: {
      useDescribeDb:
        '该文件真实 import 了 PG 入口模块(db/client / db/migrate / _groupFixture,未 vi.mock),顶层套件必须用 testUtils/dbGuard.ts 的 describeDb 而非 describe,否则无 DATABASE_URL 时测试会红、有 DB 时绕过两档分层。',
    },
  },
  create(context) {
    let hasRealDbImport = false;
    let hasDbMock = false;
    let usesDbGuard = false;
    const topLevelDescribes = [];

    return {
      ImportDeclaration(node) {
        if (typeof node.source.value === 'string' && PG_ENTRY_RE.test(node.source.value)) {
          hasRealDbImport = true;
        }
      },
      ImportExpression(node) {
        if (
          node.source.type === 'Literal' &&
          typeof node.source.value === 'string' &&
          PG_ENTRY_RE.test(node.source.value)
        ) {
          hasRealDbImport = true;
        }
      },
      CallExpression(node) {
        if (
          node.callee.type === 'Identifier' &&
          (node.callee.name === 'describeDb' || node.callee.name === 'itDb')
        ) {
          usesDbGuard = true;
          return;
        }
        if (
          node.callee.type === 'MemberExpression' &&
          node.callee.object.type === 'Identifier' &&
          node.callee.object.name === 'vi' &&
          node.callee.property.type === 'Identifier' &&
          node.callee.property.name === 'mock'
        ) {
          const arg = node.arguments[0];
          if (arg?.type === 'Literal' && typeof arg.value === 'string' && PG_ENTRY_RE.test(arg.value)) {
            hasDbMock = true;
          }
          return;
        }
        if (
          isRunnableDescribe(node.callee) &&
          node.parent.type === 'ExpressionStatement' &&
          node.parent.parent.type === 'Program'
        ) {
          topLevelDescribes.push(node);
        }
      },
      'Program:exit'() {
        if (!hasRealDbImport || hasDbMock || usesDbGuard) return;
        for (const node of topLevelDescribes) {
          context.report({ node, messageId: 'useDescribeDb' });
        }
      },
    };
  },
};
