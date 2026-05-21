// @ts-check
import tsParser from '@typescript-eslint/parser';
import agentToolFetchSignal from './eslint-rules/agent-tool-fetch-signal.js';

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
];
