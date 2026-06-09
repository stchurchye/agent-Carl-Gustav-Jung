import type { McpClient, McpToolDescriptor, McpCallResult } from './types.js';

/**
 * M4：MCP「Streamable HTTP」client（stdio 之外的第二种 transport）。
 *
 * 现在多数 MCP server 走 HTTP 而非 stdio：client POST 一条 JSON-RPC 请求到单个 endpoint，
 * server 以 `application/json`(单条响应) 或 `text/event-stream`(SSE,一条消息后关闭) 回。
 * 本实现镜像 stdioTransport 的范围 —— 只覆盖 `tools/list` + `tools/call`(无完整 initialize 握手)，
 * 足够把远端 HTTP MCP 工具 import 成本地 ToolDef(经 registerMcpServer,与 stdio 共用)。
 * 生产级完整 spec 应换 @modelcontextprotocol/sdk。
 *
 * 设计：
 * - 每请求自增 id；JSON 响应直接取 result，SSE 响应从 data: 行里找同 id 的 JSON-RPC 消息。
 * - Accept 同时声明 json + event-stream，让 server 自选；两种都解析。
 * - signal 直接透传给 fetch(abort 即 reject)；非 2xx / JSON-RPC error / 找不到响应都抛。
 * - headers 可注入鉴权(Authorization 等)。
 */
export type HttpClientOpts = {
  serverName: string;
  url: string;
  headers?: Record<string, string>;
};

type JsonRpcResponse = { id?: number; result?: unknown; error?: { message?: string } };

/** 从 SSE 响应体里提取匹配 id 的 JSON-RPC 消息(找不到 id 匹配时退回最后一条可解析的)。 */
export function parseSseForId(body: string, id: number): JsonRpcResponse | null {
  let fallback: JsonRpcResponse | null = null;
  for (const rawLine of body.split('\n')) {
    const line = rawLine.trim();
    if (!line.startsWith('data:')) continue;
    const data = line.slice('data:'.length).trim();
    if (!data || data === '[DONE]') continue;
    let msg: JsonRpcResponse;
    try {
      msg = JSON.parse(data) as JsonRpcResponse;
    } catch {
      continue;
    }
    if (msg.id === id) return msg;
    if (msg.result !== undefined || msg.error !== undefined) fallback = msg;
  }
  return fallback;
}

export class McpHttpClient implements McpClient {
  readonly serverName: string;
  private url: string;
  private headers: Record<string, string>;
  private nextId = 1;

  constructor(opts: HttpClientOpts) {
    this.serverName = opts.serverName;
    this.url = opts.url;
    this.headers = opts.headers ?? {};
  }

  private async sendRequest(method: string, params: unknown, signal?: AbortSignal): Promise<unknown> {
    const id = this.nextId++;
    const res = await fetch(this.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        ...this.headers,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
      signal,
    });
    if (!res.ok) {
      throw new Error(`mcp http "${this.serverName}" HTTP ${res.status}`);
    }
    const ct = res.headers.get('content-type') ?? '';
    const text = await res.text();
    let msg: JsonRpcResponse | null;
    if (ct.includes('text/event-stream')) {
      msg = parseSseForId(text, id);
    } else {
      try {
        msg = JSON.parse(text) as JsonRpcResponse;
      } catch {
        throw new Error(`mcp http "${this.serverName}": non-JSON response`);
      }
    }
    if (!msg) {
      throw new Error(`mcp http "${this.serverName}": no JSON-RPC response for id ${id}`);
    }
    if (msg.error) {
      throw new Error(msg.error.message ?? `mcp http "${this.serverName}" error`);
    }
    return msg.result;
  }

  async listTools(): Promise<McpToolDescriptor[]> {
    const res = (await this.sendRequest('tools/list', {})) as { tools?: McpToolDescriptor[] };
    return res?.tools ?? [];
  }

  async callTool(
    name: string,
    input: unknown,
    opts?: { signal?: AbortSignal },
  ): Promise<McpCallResult> {
    const res = (await this.sendRequest('tools/call', { name, arguments: input }, opts?.signal)) as {
      output?: unknown;
      content?: unknown;
    };
    return { output: res?.output ?? res?.content ?? res };
  }
}
