// @ts-check
import tsParser from '@typescript-eslint/parser';
import agentToolFetchSignal from './eslint-rules/agent-tool-fetch-signal.js';
import dbDescribeGuard from './eslint-rules/db-describe-guard.js';

/** @type {import('eslint').Linter.Config[]} */
export default [
  {
    files: ['src/lib/agent/tools/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    plugins: {
      'agent-tool-rules': {
        rules: {
          'fetch-signal': agentToolFetchSignal,
        },
      },
    },
    rules: {
      'agent-tool-rules/fetch-signal': 'error',
    },
  },
  {
    // P0-S1 兜底:真连 PG 的测试文件必须用 describeDb,防止新增文件绕过两档分层
    files: ['src/**/*.test.ts'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    plugins: {
      'test-rules': {
        rules: {
          'db-describe-guard': dbDescribeGuard,
        },
      },
    },
    rules: {
      'test-rules/db-describe-guard': 'error',
    },
  },
];
