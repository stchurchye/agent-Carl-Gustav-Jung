import { toolRegistry, type ToolDef } from '../toolRegistry.js';
import type { McpClient } from './types.js';

/**
 * 把一个 MCP server 暴露的所有工具注册成本地 ToolDef。
 *
 * - 命名空间：`mcp:<serverName>:<remoteToolName>`
 * - approvalMode 默认 `ask`：远端工具默认要 confirm，可在 topic_skill 里改成 auto
 * - costHint 默认 `medium`，hasSideEffects=true（保守）
 *
 * 返回注册成功的工具完整 name 列表。
 */
export async function registerMcpServer(client: McpClient): Promise<string[]> {
  const remoteTools = await client.listTools();
  const names: string[] = [];

  for (const remote of remoteTools) {
    const fullName = `mcp:${client.serverName}:${remote.name}`;
    if (toolRegistry.get(fullName)) {
      // 同名已注册（典型场景：热重载），跳过即可。
      names.push(fullName);
      continue;
    }
    const def: ToolDef = {
      name: fullName,
      description: `[MCP:${client.serverName}] ${remote.description}`,
      inputSchema: remote.inputSchema,
      approvalMode: 'ask',
      costHint: 'medium',
      hasSideEffects: true,
      idempotent: false,
      async handler(input, ctx) {
        const res = await client.callTool(remote.name, input, {
          signal: ctx.signal,
        });
        return res.output;
      },
    };
    toolRegistry.register(def);
    names.push(fullName);
  }
  return names;
}
