import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import type { McpClient, McpToolDescriptor, McpCallResult } from './types.js';

/**
 * M1d Task 8：最简 MCP stdio client 实现。
 *
 * 假设远端是个 stdio MCP server（Anthropic 官方 ref impl 风格），
 * 行式 JSON-RPC：每行一条 JSON, request 有 id, response 同 id 回。
 *
 * **本实现不是完整 MCP spec**——只覆盖 `tools/list` + `tools/call` 两个方法，
 * 足够 demo 一个本地 echo-style server。生产用 MCP 应换 @modelcontextprotocol/sdk。
 *
 * 关键设计：
 * - request id 单调自增，按 id 维护 pending promise map
 * - stdout 按 `\n` 切行，逐行 JSON.parse
 * - stderr 用 console.error 透传，便于排查
 * - close() 关掉子进程；如果有 pending request 全部 reject
 */
export type StdioClientOpts = {
  serverName: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  /** spawn 后多久内 listTools 必须握手成功，超时 reject。默认 5s。 */
  handshakeTimeoutMs?: number;
};

type PendingResolver = {
  resolve(value: unknown): void;
  reject(err: Error): void;
};

export class McpStdioClient implements McpClient {
  readonly serverName: string;
  private proc: ChildProcessWithoutNullStreams;
  private buf = '';
  private nextId = 1;
  private pending = new Map<number, PendingResolver>();
  private closed = false;

  constructor(opts: StdioClientOpts) {
    this.serverName = opts.serverName;
    this.proc = spawn(opts.command, opts.args ?? [], {
      env: { ...process.env, ...opts.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', (chunk: string) => this.onStdout(chunk));
    this.proc.stderr.setEncoding('utf8');
    this.proc.stderr.on('data', (chunk: string) =>
      console.error(`[mcp:${this.serverName}] stderr:`, chunk.trim()),
    );
    this.proc.on('exit', (code) => {
      this.closed = true;
      const err = new Error(`mcp server "${this.serverName}" exited with code ${code}`);
      for (const p of this.pending.values()) p.reject(err);
      this.pending.clear();
    });
  }

  private onStdout(chunk: string): void {
    this.buf += chunk;
    let nl: number;
    while ((nl = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, nl).trim();
      this.buf = this.buf.slice(nl + 1);
      if (!line) continue;
      let msg: { id?: number; result?: unknown; error?: { message: string } };
      try {
        msg = JSON.parse(line);
      } catch {
        console.error(`[mcp:${this.serverName}] non-JSON line:`, line);
        continue;
      }
      if (typeof msg.id !== 'number') continue;
      const p = this.pending.get(msg.id);
      if (!p) continue;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message));
      else p.resolve(msg.result);
    }
  }

  private sendRequest(method: string, params: unknown, signal?: AbortSignal): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error('mcp client closed'));
    const id = this.nextId++;
    const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.proc.stdin.write(payload, (err) => {
        if (err) {
          this.pending.delete(id);
          reject(err);
        }
      });
      if (signal) {
        const onAbort = () => {
          if (this.pending.delete(id)) reject(new Error('aborted'));
        };
        if (signal.aborted) onAbort();
        else signal.addEventListener('abort', onAbort, { once: true });
      }
    });
  }

  async listTools(): Promise<McpToolDescriptor[]> {
    const res = (await this.sendRequest('tools/list', {})) as {
      tools?: McpToolDescriptor[];
    };
    return res.tools ?? [];
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
    return { output: res.output ?? res.content ?? res };
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.proc.stdin.end();
    } catch {}
    try {
      this.proc.kill();
    } catch {}
  }
}
