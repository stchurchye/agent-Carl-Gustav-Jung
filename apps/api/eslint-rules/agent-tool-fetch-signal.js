'use strict';

/**
 * M1f #3：禁止 `apps/api/src/lib/agent/tools/` 下的 `fetch()` 调用不带 signal。
 *
 * Why：用户 cancel 后 tool handler 仍在跑 = 浪费 token + race conditions + 写库幽灵。
 * 工具作者必须把 `ctx.signal`（或一个绑了 ctx.signal 的 AbortController.signal）传给
 * 每次 fetch 的 options，runtime 的 cancel 信号才能真正中断网络 IO。
 *
 * 检测规则：CallExpression callee 是 Identifier `fetch`，且第二个参数是
 * ObjectExpression 但其 properties 里没有 `signal` key → 报错。
 *
 * 故意宽容：
 * - `fetch(url)` 单参不报（很多场景就是简单 GET，要求所有 tool fetch 都至少传两参
 *   太死板）。Tool 作者自己保证多参时带 signal 即可。
 * - 第二个参数是 SpreadElement / Identifier 等动态参数也不报（无法静态分析），
 *   留给人工 audit + 代码评审。
 *
 * 配置：本规则只对 `src/lib/agent/tools/**` 生效（apps/api 当前未启用 ESLint 流水线，
 * 待后续 lint pipeline 建立后 `eslint.config.js` / `.eslintrc.cjs` 注册即可）。
 */

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'agent tool 内的 fetch() 必须传 signal',
      category: 'Possible Errors',
      recommended: false,
    },
    schema: [],
    messages: {
      missingSignal:
        "agent/tools/ 下的 fetch() 必须在 options 对象里传 signal: ctx.signal（或绑了 ctx.signal 的 AbortController.signal）。否则 cancelRun 后工具不会停。",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        if (
          node.callee.type !== 'Identifier' ||
          node.callee.name !== 'fetch'
        ) {
          return;
        }
        if (node.arguments.length < 2) return;
        const opts = node.arguments[1];
        if (opts.type !== 'ObjectExpression') return;
        const hasSignal = opts.properties.some((p) => {
          if (p.type !== 'Property') return false;
          if (p.key.type === 'Identifier' && p.key.name === 'signal') return true;
          if (p.key.type === 'Literal' && p.key.value === 'signal') return true;
          return false;
        });
        if (!hasSignal) {
          context.report({ node, messageId: 'missingSignal' });
        }
      },
    };
  },
};
