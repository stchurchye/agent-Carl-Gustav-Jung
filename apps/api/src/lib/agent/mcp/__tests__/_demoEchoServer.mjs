#!/usr/bin/env node
// Minimal stdio MCP server used by stdioTransport.test.ts
// 支持 tools/list 与 tools/call (echo_upper, add)

import { createInterface } from 'readline';

const rl = createInterface({ input: process.stdin });

const tools = [
  {
    name: 'echo_upper',
    description: 'Return input.text upper-cased.',
    inputSchema: {
      type: 'object',
      required: ['text'],
      properties: { text: { type: 'string' } },
    },
  },
  {
    name: 'add',
    description: 'Sum input.a + input.b',
    inputSchema: {
      type: 'object',
      required: ['a', 'b'],
      properties: { a: { type: 'number' }, b: { type: 'number' } },
    },
  },
];

function reply(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
}
function fail(id, message) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { message } }) + '\n');
}

rl.on('line', (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  const { id, method, params } = msg;
  if (method === 'tools/list') {
    return reply(id, { tools });
  }
  if (method === 'tools/call') {
    const { name, arguments: args } = params ?? {};
    if (name === 'echo_upper') {
      return reply(id, { output: { text: String(args?.text ?? '').toUpperCase() } });
    }
    if (name === 'add') {
      return reply(id, { output: { sum: Number(args?.a ?? 0) + Number(args?.b ?? 0) } });
    }
    return fail(id, 'unknown tool: ' + name);
  }
  fail(id, 'unknown method: ' + method);
});
