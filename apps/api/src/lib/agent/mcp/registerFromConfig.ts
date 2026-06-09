/**
 * M4 config 接线：按 env `MCP_SERVERS`(JSON 数组)在启动期注册 MCP server，把远端工具
 * import 成本地 ToolDef。支持 stdio + Streamable HTTP 两种 transport。
 *
 * 设计：
 * - **每 server fail-open**：一个 server 配置错/不可达/超时 → 记日志跳过，不阻塞启动、不影响其他 server。
 * - **超时**：listTools(connect+handshake) 套 timeout，防一个挂死的 server 卡住整个启动。
 * - stdio client 注册失败时 close()，避免泄漏子进程。
 * - 配置解析(parseMcpServerConfigs)是纯函数,单测覆盖;注册副作用单列。
 *
 * env 示例：
 *   MCP_SERVERS='[
 *     {"name":"weather","transport":"http","url":"https://mcp.x/rpc","headers":{"Authorization":"Bearer …"}},
 *     {"name":"fs","transport":"stdio","command":"npx","args":["-y","@modelcontextprotocol/server-filesystem","/data"]}
 *   ]'
 */
import { registerMcpServer } from './register.js';
import { McpStdioClient } from './stdioTransport.js';
import { McpHttpClient } from './httpTransport.js';
import type { McpClient } from './types.js';

export type McpServerConfig =
  | { name: string; transport: 'http'; url: string; headers?: Record<string, string> }
  | { name: string; transport: 'stdio'; command: string; args?: string[]; env?: Record<string, string> };

export type McpRegisterResult = { server: string; transport: string; tools: number; error?: string };

function isStrRecord(v: unknown): v is Record<string, string> {
  return !!v && typeof v === 'object' && !Array.isArray(v) &&
    Object.values(v as Record<string, unknown>).every((x) => typeof x === 'string');
}

/** 解析 MCP_SERVERS JSON → 合法配置数组。非法整体/单项都跳过(记 warn),绝不抛。 */
export function parseMcpServerConfigs(raw: string | undefined): McpServerConfig[] {
  if (!raw || !raw.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error('[mcp] MCP_SERVERS 不是合法 JSON,忽略整段');
    return [];
  }
  if (!Array.isArray(parsed)) {
    console.error('[mcp] MCP_SERVERS 必须是数组,忽略');
    return [];
  }
  const out: McpServerConfig[] = [];
  const seen = new Set<string>();
  for (const e of parsed) {
    if (!e || typeof e !== 'object') continue;
    const o = e as Record<string, unknown>;
    const name = typeof o.name === 'string' ? o.name.trim() : '';
    if (!name) {
      console.error('[mcp] server 配置缺 name,跳过');
      continue;
    }
    if (seen.has(name)) {
      console.error(`[mcp] server name "${name}" 重复,跳过后者`);
      continue;
    }
    if (o.transport === 'http') {
      if (typeof o.url !== 'string' || !o.url.trim()) {
        console.error(`[mcp] "${name}" transport=http 缺 url,跳过`);
        continue;
      }
      seen.add(name);
      out.push({ name, transport: 'http', url: o.url, headers: isStrRecord(o.headers) ? o.headers : undefined });
    } else if (o.transport === 'stdio') {
      if (typeof o.command !== 'string' || !o.command.trim()) {
        console.error(`[mcp] "${name}" transport=stdio 缺 command,跳过`);
        continue;
      }
      seen.add(name);
      out.push({
        name,
        transport: 'stdio',
        command: o.command,
        args: Array.isArray(o.args) ? (o.args.filter((a) => typeof a === 'string') as string[]) : undefined,
        env: isStrRecord(o.env) ? o.env : undefined,
      });
    } else {
      console.error(`[mcp] "${name}" transport 必须是 http|stdio,跳过`);
    }
  }
  return out;
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms)),
  ]);
}

/**
 * 按配置(默认读 process.env.MCP_SERVERS)注册所有 MCP server。每 server fail-open + 超时。
 * 返回逐 server 结果(便于启动日志/诊断)。
 */
export async function registerMcpServersFromEnv(opts?: {
  raw?: string;
  timeoutMs?: number;
}): Promise<McpRegisterResult[]> {
  const configs = parseMcpServerConfigs(opts?.raw ?? process.env.MCP_SERVERS);
  const timeoutMs = opts?.timeoutMs ?? 10_000;
  const results: McpRegisterResult[] = [];
  for (const cfg of configs) {
    let client: McpClient | undefined;
    try {
      client =
        cfg.transport === 'http'
          ? new McpHttpClient({ serverName: cfg.name, url: cfg.url, headers: cfg.headers })
          : new McpStdioClient({ serverName: cfg.name, command: cfg.command, args: cfg.args, env: cfg.env });
      const names = await withTimeout(
        registerMcpServer(client),
        timeoutMs,
        `mcp register "${cfg.name}"`,
      );
      results.push({ server: cfg.name, transport: cfg.transport, tools: names.length });
      console.log(`[mcp] registered "${cfg.name}" (${cfg.transport}): ${names.length} tools`);
    } catch (e) {
      // stdio 注册失败 → close 防子进程泄漏(McpStdioClient 有 close;http 无持久进程)。
      try {
        const maybeClose = (client as { close?: () => void } | undefined)?.close;
        if (typeof maybeClose === 'function') maybeClose.call(client);
      } catch {
        /* ignore */
      }
      const error = e instanceof Error ? e.message : String(e);
      console.error(`[mcp] register "${cfg.name}" (${cfg.transport}) failed, skipped:`, error);
      results.push({ server: cfg.name, transport: cfg.transport, tools: 0, error });
    }
  }
  return results;
}
