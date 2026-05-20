import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { McpStdioClient } from '../stdioTransport.js';
import { registerMcpServer } from '../register.js';
import { toolRegistry } from '../../toolRegistry.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DEMO_SERVER = join(__dirname, '_demoEchoServer.mjs');

describe('McpStdioClient + demo server (M1d Task 8)', () => {
  let client: McpStdioClient | null = null;

  beforeEach(() => {
    client = new McpStdioClient({
      serverName: 'demo',
      command: process.execPath, // node
      args: [DEMO_SERVER],
    });
  });
  afterEach(() => {
    client?.close();
    client = null;
  });

  it('listTools returns demo server tools', async () => {
    const tools = await client!.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['add', 'echo_upper']);
  });

  it('callTool echo_upper returns upper-cased text', async () => {
    const r = await client!.callTool('echo_upper', { text: 'hello mcp' });
    expect(r.output).toEqual({ text: 'HELLO MCP' });
  });

  it('callTool add returns sum', async () => {
    const r = await client!.callTool('add', { a: 3, b: 4 });
    expect(r.output).toEqual({ sum: 7 });
  });

  it('registerMcpServer wraps remote tools as namespaced local ToolDefs', async () => {
    const names = await registerMcpServer(client!);
    expect(names.sort()).toEqual(['mcp:demo:add', 'mcp:demo:echo_upper']);
    const echo = toolRegistry.get('mcp:demo:echo_upper');
    expect(echo).toBeTruthy();
    const result = await echo!.handler(
      { text: 'mixed CASE' },
      {
        runId: 'r', stepId: 's', ownerId: 'u', channel: 'private',
        signal: new AbortController().signal,
      },
    );
    expect(result).toEqual({ text: 'MIXED CASE' });
  });

  it('aborting via signal rejects the pending callTool', async () => {
    const ctrl = new AbortController();
    const p = client!.callTool('add', { a: 1, b: 2 }, { signal: ctrl.signal });
    ctrl.abort();
    await expect(p).rejects.toThrow(/aborted/);
  });
});
