import { describe, expect, it } from 'vitest';
import { registerAgentTools } from '../registerAgentTools.js';
import { toolRegistry } from '../toolRegistry.js';

describe('registerAgentTools (M1c)', () => {
  it('registers all M1c real tools and is idempotent', () => {
    registerAgentTools();
    registerAgentTools(); // ← 不应抛错

    for (const name of [
      'magi_system_read',
      'magi_content_ingest',
      'search_web',
      'fetch_url',
      'datetime_now',
      'doc_export_markdown',
    ]) {
      expect(toolRegistry.get(name), `tool ${name}`).toBeDefined();
    }
  });
});
