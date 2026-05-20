import { describe, expect, it, vi } from 'vitest';
import { registerMcpServer } from '../mcp/register.js';
import type { McpClient } from '../mcp/types.js';
import { toolRegistry } from '../toolRegistry.js';

function makeClient(serverName: string): McpClient {
  return {
    serverName,
    listTools: vi.fn(async () => [
      {
        name: 'echo',
        description: 'echo remote tool',
        inputSchema: {
          type: 'object',
          required: ['text'],
          properties: { text: { type: 'string' } },
        },
      },
    ]),
    callTool: vi.fn(async (_name, input) => ({ output: { echoed: input } })),
  };
}

describe('MCP adapter (M1c skeleton)', () => {
  it('registers remote tool under namespaced name', async () => {
    const client = makeClient('demo-' + Math.random().toString(36).slice(2, 8));
    const names = await registerMcpServer(client);
    expect(names.length).toBe(1);
    const fullName = names[0]!;
    expect(fullName).toMatch(/^mcp:demo-/);
    const def = toolRegistry.get(fullName);
    expect(def).toBeDefined();
    expect(def!.approvalMode).toBe('ask');
    expect(def!.hasSideEffects).toBe(true);
  });

  it('handler forwards to client.callTool', async () => {
    const client = makeClient('h-' + Math.random().toString(36).slice(2, 8));
    const names = await registerMcpServer(client);
    const def = toolRegistry.get(names[0]!)!;
    const out = await def.handler(
      { text: 'hi' },
      {
        runId: 'r',
        stepId: 's',
        ownerId: 'u',
        channel: 'private',
        signal: new AbortController().signal,
      },
    );
    expect(out).toEqual({ echoed: { text: 'hi' } });
    expect(client.callTool).toHaveBeenCalledWith(
      'echo',
      { text: 'hi' },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('registering twice does not throw (idempotent registration)', async () => {
    const client = makeClient('idem-' + Math.random().toString(36).slice(2, 8));
    await registerMcpServer(client);
    await expect(registerMcpServer(client)).resolves.not.toThrow();
  });
});
