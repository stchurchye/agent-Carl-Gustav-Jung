import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseMcpServerConfigs, registerMcpServersFromEnv } from '../mcp/registerFromConfig.js';
import { toolRegistry } from '../toolRegistry.js';

describe('parseMcpServerConfigs', () => {
  it('空/undefined → []', () => {
    expect(parseMcpServerConfigs(undefined)).toEqual([]);
    expect(parseMcpServerConfigs('')).toEqual([]);
    expect(parseMcpServerConfigs('   ')).toEqual([]);
  });
  it('非法 JSON / 非数组 → [](不抛)', () => {
    expect(parseMcpServerConfigs('{bad json')).toEqual([]);
    expect(parseMcpServerConfigs('{"name":"x"}')).toEqual([]);
  });
  it('合法 http + stdio 各一', () => {
    const out = parseMcpServerConfigs(JSON.stringify([
      { name: 'w', transport: 'http', url: 'http://x/rpc', headers: { Authorization: 'Bearer t' } },
      { name: 'fs', transport: 'stdio', command: 'npx', args: ['-y', 'srv'], env: { K: 'v' } },
    ]));
    expect(out).toEqual([
      { name: 'w', transport: 'http', url: 'http://x/rpc', headers: { Authorization: 'Bearer t' } },
      { name: 'fs', transport: 'stdio', command: 'npx', args: ['-y', 'srv'], env: { K: 'v' } },
    ]);
  });
  it('缺 name / http 缺 url / stdio 缺 command / 非法 transport → 跳过', () => {
    const out = parseMcpServerConfigs(JSON.stringify([
      { transport: 'http', url: 'http://x' },                 // 无 name
      { name: 'a', transport: 'http' },                        // http 无 url
      { name: 'b', transport: 'stdio' },                       // stdio 无 command
      { name: 'c', transport: 'ws', url: 'x' },                // 非法 transport
      { name: 'd', transport: 'http', url: 'http://ok/rpc' },  // 合法
    ]));
    expect(out.map((c) => c.name)).toEqual(['d']);
  });
  it('重复 name → 后者跳过；非字符串 headers/env → 丢弃', () => {
    const out = parseMcpServerConfigs(JSON.stringify([
      { name: 'dup', transport: 'http', url: 'http://1/rpc', headers: { a: 1 } }, // headers 含非字符串 → 丢
      { name: 'dup', transport: 'http', url: 'http://2/rpc' },                    // 重名 → 跳
    ]));
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('dup');
    expect((out[0] as { headers?: unknown }).headers).toBeUndefined();
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

describe('registerMcpServersFromEnv (HTTP transport, mock fetch)', () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it('happy：http server 注册成功 → 工具入 registry', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      if (body.method === 'tools/list') return jsonResponse({ id: body.id, result: { tools: [{ name: 'cfg_echo', description: 'd', inputSchema: { type: 'object' } }] } });
      return jsonResponse({ id: body.id, error: { message: 'no' } });
    }));
    const raw = JSON.stringify([{ name: 'cfgsrv', transport: 'http', url: 'http://x/rpc' }]);
    const results = await registerMcpServersFromEnv({ raw, timeoutMs: 2000 });
    expect(results).toEqual([{ server: 'cfgsrv', transport: 'http', tools: 1 }]);
    expect(toolRegistry.get('mcp:cfgsrv:cfg_echo')).toBeDefined();
  });

  it('fail-open：一个 server 不可达(500)被跳过，另一个仍注册', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      if (String(url).includes('bad')) return new Response('boom', { status: 500 });
      const body = JSON.parse(init.body as string);
      return jsonResponse({ id: body.id, result: { tools: [{ name: 'good_tool', description: 'd', inputSchema: { type: 'object' } }] } });
    }));
    const raw = JSON.stringify([
      { name: 'badsrv', transport: 'http', url: 'http://bad/rpc' },
      { name: 'goodsrv', transport: 'http', url: 'http://good/rpc' },
    ]);
    const results = await registerMcpServersFromEnv({ raw, timeoutMs: 2000 });
    expect(results[0]).toMatchObject({ server: 'badsrv', tools: 0 });
    expect(results[0].error).toBeTruthy();
    expect(results[1]).toEqual({ server: 'goodsrv', transport: 'http', tools: 1 });
    expect(toolRegistry.get('mcp:goodsrv:good_tool')).toBeDefined();
  });

  it('timeout：server 永不响应 → 超时跳过(error 含 timeout)', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => { /* never resolves */ })));
    const raw = JSON.stringify([{ name: 'slow', transport: 'http', url: 'http://slow/rpc' }]);
    const results = await registerMcpServersFromEnv({ raw, timeoutMs: 60 });
    expect(results[0].server).toBe('slow');
    expect(results[0].tools).toBe(0);
    expect(results[0].error).toMatch(/timeout/);
  });

  it('空配置 → 不注册、返 []', async () => {
    expect(await registerMcpServersFromEnv({ raw: '' })).toEqual([]);
  });
});
