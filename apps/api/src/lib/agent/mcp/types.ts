/**
 * MCP（Model Context Protocol）适配层最小骨架。
 *
 * M1c 只定义 client 协议接口，不接任何真实远端；
 * M1d / M1e 再接 SSE / WebSocket transport。
 *
 * 设计目标：
 * - registerMcpServer(client) 把远端工具一次性 import 成本地 ToolDef
 * - 工具名形如 `mcp:<serverName>:<remoteToolName>`，避免和本地工具冲突
 * - 远端工具默认 `approvalMode: 'ask'`、`hasSideEffects: true`，安全优先
 */
import type { JSONSchema7 } from 'json-schema';

export type McpToolDescriptor = {
  name: string;
  description: string;
  inputSchema: JSONSchema7;
};

export type McpCallResult = {
  output: unknown;
};

export type McpClient = {
  /** 服务器逻辑名，用于工具命名空间前缀。 */
  serverName: string;

  /** 拉远端工具列表（连接 + handshake 都封在 client 内部）。 */
  listTools(): Promise<McpToolDescriptor[]>;

  /** 远端工具调用。失败抛错由 runtime 统一处理。 */
  callTool(name: string, input: unknown, opts?: {
    signal?: AbortSignal;
  }): Promise<McpCallResult>;
};
