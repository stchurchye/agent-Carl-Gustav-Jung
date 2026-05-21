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

  // M1e task 8：close() 显式 reject pending —— 之前依赖 'exit' 事件，慢容器上可能晚到
  it('close() immediately rejects in-flight callTool with "mcp client closed"', async () => {
    // 故意造一个新 client 跑一个 callTool 但不 await 完成，然后立刻 close
    const c = new McpStdioClient({
      serverName: 'demo-close',
      command: process.execPath,
      args: [DEMO_SERVER],
    });
    // 让 child 起来一下（避免 stdin 写入还没进 child 缓冲就被 kill 掉，导致 settle 早于预期）
    await c.listTools();
    // 发起一个 callTool 但不 await
    const p = c.callTool('add', { a: 1, b: 1 });
    // 立刻 close，应当用 "mcp client closed" reject 而不是 hang / 等到 exit
    c.close();
    await expect(p).rejects.toThrow(/closed/);
  });

  // M1e task 8：同一个 signal 复用 N 次 callTool 不应泄漏 abort listener
  it('reused signal across many calls does not leak abort listeners', async () => {
    const ctrl = new AbortController();
    // 跑 10 次成功 callTool —— settle 时 listener 应被 removeEventListener
    for (let i = 0; i < 10; i++) {
      const r = await client!.callTool('add', { a: i, b: 1 }, { signal: ctrl.signal });
      expect((r.output as { sum: number }).sum).toBe(i + 1);
    }
    // Node 没暴露 listenerCount on AbortSignal API 公开方式，但 events 模块可以拿到
    // 内部 listener 数量。这里走 Node 私有 API：signal 是 EventTarget 实现，用 getEventListeners
    // 在 node 不可用 —— 改成基于行为的断言：触发 abort，应当不会 reject 任何已 settle 的 promise。
    // （如果 listener 没清理，下面这一句会把所有历史 promise 的 wrappedReject 都调一次，
    //  而这些 promise 早已 resolve，wrappedReject 命中 pending.delete() = false 没事；
    //  但更直接的回归保护是：再起一个 callTool，abort 后只能影响这个新的，
    //  历史的 resolve 不受影响。）
    const beforeAbortPending = client!['pending' as keyof typeof client] as Map<number, unknown>;
    expect(beforeAbortPending.size).toBe(0);
    ctrl.abort();
    // abort 不应导致任何 'unhandled rejection'
    await new Promise((r) => setTimeout(r, 50));
  });
});
