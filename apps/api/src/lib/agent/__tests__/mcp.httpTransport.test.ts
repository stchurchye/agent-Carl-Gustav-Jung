import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { McpHttpClient, parseSseForId } from '../mcp/httpTransport.js';
import { registerMcpServer } from '../mcp/register.js';
import { toolRegistry } from '../toolRegistry.js';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
function sseResponse(body: string): Response {
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

describe('parseSseForId', () => {
  it('提取匹配 id 的 JSON-RPC 消息', () => {
    const body = 'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"tools":[]}}\n\n';
    expect(parseSseForId(body, 1)).toEqual({ jsonrpc: '2.0', id: 1, result: { tools: [] } } as never);
  });
  it('忽略非 data 行 / [DONE] / 非 JSON，找不到 id 退回最后一条有效响应', () => {
    const body = ': comment\ndata: not-json\ndata: {"id":99,"result":{"x":1}}\ndata: [DONE]\n';
    expect(parseSseForId(body, 7)).toEqual({ id: 99, result: { x: 1 } } as never);
  });
  it('全无有效响应 → null', () => {
    expect(parseSseForId('data: [DONE]\n: ping\n', 1)).toBeNull();
  });
});

describe('McpHttpClient', () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it('listTools：JSON 响应 → tools 数组；POST JSON-RPC tools/list', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      expect(body.method).toBe('tools/list');
      expect(body.jsonrpc).toBe('2.0');
      return jsonResponse({ jsonrpc: '2.0', id: body.id, result: { tools: [{ name: 't', description: 'd', inputSchema: { type: 'object' } }] } });
    });
    vi.stubGlobal('fetch', fetchMock);
    const c = new McpHttpClient({ serverName: 'srv', url: 'http://mcp.example/rpc' });
    const tools = await c.listTools();
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('t');
  });

  it('callTool：JSON 响应 result.content → output；params 形如 {name, arguments}', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      expect(body.method).toBe('tools/call');
      expect(body.params).toEqual({ name: 'echo', arguments: { q: 'hi' } });
      return jsonResponse({ jsonrpc: '2.0', id: body.id, result: { content: 'pong' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    const c = new McpHttpClient({ serverName: 'srv', url: 'http://mcp.example/rpc' });
    const out = await c.callTool('echo', { q: 'hi' });
    expect(out.output).toBe('pong');
  });

  it('SSE 响应 → 正确解析', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      const id = JSON.parse(init.body as string).id;
      return sseResponse(`data: {"jsonrpc":"2.0","id":${id},"result":{"output":42}}\n\n`);
    }));
    const c = new McpHttpClient({ serverName: 'srv', url: 'http://mcp.example/rpc' });
    expect((await c.callTool('x', {})).output).toBe(42);
  });

  it('注入鉴权 header', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
      const id = JSON.parse(init.body as string).id;
      return jsonResponse({ id, result: { tools: [] } });
    });
    vi.stubGlobal('fetch', fetchMock);
    const c = new McpHttpClient({ serverName: 'srv', url: 'http://x/rpc', headers: { Authorization: 'Bearer tok' } });
    await c.listTools();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('HTTP 非 2xx → 抛', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 503 })));
    const c = new McpHttpClient({ serverName: 'srv', url: 'http://x/rpc' });
    await expect(c.listTools()).rejects.toThrow(/HTTP 503/);
  });

  it('JSON-RPC error → 抛 error.message', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      const id = JSON.parse(init.body as string).id;
      return jsonResponse({ jsonrpc: '2.0', id, error: { message: 'tool not found' } });
    }));
    const c = new McpHttpClient({ serverName: 'srv', url: 'http://x/rpc' });
    await expect(c.callTool('nope', {})).rejects.toThrow(/tool not found/);
  });

  it('abort → fetch 收到 signal 并 reject', async () => {
    const ac = new AbortController();
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        (init.signal as AbortSignal).addEventListener('abort', () => {
          const e = new Error('aborted'); e.name = 'AbortError'; reject(e);
        });
      });
    }));
    const c = new McpHttpClient({ serverName: 'srv', url: 'http://x/rpc' });
    const p = c.callTool('x', {}, { signal: ac.signal });
    ac.abort();
    await expect(p).rejects.toThrow();
  });

  it('集成：registerMcpServer(McpHttpClient) 注册远端工具 + 调用经 HTTP 委派', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      if (body.method === 'tools/list') {
        return jsonResponse({ id: body.id, result: { tools: [{ name: 'remote_echo', description: 'echo', inputSchema: { type: 'object' } }] } });
      }
      if (body.method === 'tools/call') {
        return jsonResponse({ id: body.id, result: { content: 'remote-pong' } });
      }
      return jsonResponse({ id: body.id, error: { message: 'unknown method' } });
    }));
    const c = new McpHttpClient({ serverName: 'httpsrv', url: 'http://x/rpc' });
    const names = await registerMcpServer(c);
    expect(names).toContain('mcp:httpsrv:remote_echo');
    const tool = toolRegistry.get('mcp:httpsrv:remote_echo');
    expect(tool).toBeDefined();
    // 远端工具默认 approvalMode='ask'(保守),由 registerMcpServer 设。
    expect(tool!.approvalMode).toBe('ask');
    // 调用本地代理 ToolDef → 经 McpHttpClient → HTTP tools/call → 远端结果。
    const out = await tool!.handler({ q: 'x' }, {
      runId: 'r', stepId: 's', ownerId: 'u', channel: 'private', signal: new AbortController().signal,
    });
    expect(out).toBe('remote-pong');
  });
});
