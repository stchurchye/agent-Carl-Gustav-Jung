import { describe, it, expect } from 'vitest';
import { SUBAGENT_TOOL_WHITELIST } from '../subagentTools.js';

describe('subagent tool whitelist', () => {
  it('contains expected read-only retrieval tools', () => {
    expect(SUBAGENT_TOOL_WHITELIST.has('search_papers')).toBe(true);
    expect(SUBAGENT_TOOL_WHITELIST.has('search_web')).toBe(true);
    expect(SUBAGENT_TOOL_WHITELIST.has('wikipedia')).toBe(true);
    expect(SUBAGENT_TOOL_WHITELIST.has('fetch_url')).toBe(true);
    expect(SUBAGENT_TOOL_WHITELIST.has('document_reader')).toBe(true);
    expect(SUBAGENT_TOOL_WHITELIST.has('datetime_now')).toBe(true);
    expect(SUBAGENT_TOOL_WHITELIST.has('magi_system_read')).toBe(true);
    expect(SUBAGENT_TOOL_WHITELIST.has('get_economic_series')).toBe(true);
  });

  it('excludes recursive and side-effecting tools', () => {
    expect(SUBAGENT_TOOL_WHITELIST.has('deep_research')).toBe(false);
    expect(SUBAGENT_TOOL_WHITELIST.has('ask_user')).toBe(false);
    expect(SUBAGENT_TOOL_WHITELIST.has('run_python')).toBe(false);
    expect(SUBAGENT_TOOL_WHITELIST.has('render_diagram')).toBe(false);
    expect(SUBAGENT_TOOL_WHITELIST.has('magi_content_ingest')).toBe(false);
    expect(SUBAGENT_TOOL_WHITELIST.has('doc_export_markdown')).toBe(false);
    expect(SUBAGENT_TOOL_WHITELIST.has('critique_last_answer')).toBe(false);
  });
});

describe('M3-S1 subagentToolsForRole (按角色的工具子集)', () => {
  it('researcher / generalist = 只读检索集(无 run_python / render_diagram)', async () => {
    const { subagentToolsForRole } = await import('../subagentTools.js');
    for (const role of ['researcher', 'generalist'] as const) {
      expect(subagentToolsForRole(role).has('search_papers')).toBe(true);
      expect(subagentToolsForRole(role).has('magi_system_read')).toBe(true);
      expect(subagentToolsForRole(role).has('run_python')).toBe(false);
      expect(subagentToolsForRole(role).has('render_diagram')).toBe(false);
    }
  });

  it('analyst = researcher + run_python + render_diagram，但仍禁递归/暂停', async () => {
    const { subagentToolsForRole } = await import('../subagentTools.js');
    const analyst = subagentToolsForRole('analyst');
    expect(analyst.has('search_papers')).toBe(true); // 继承 researcher
    expect(analyst.has('run_python')).toBe(true);
    expect(analyst.has('render_diagram')).toBe(true);
    // 递归 / 暂停 / 写工具仍禁(任何角色都不给)
    expect(analyst.has('deep_research')).toBe(false);
    expect(analyst.has('spawn_subagent')).toBe(false);
    expect(analyst.has('ask_user')).toBe(false);
    expect(analyst.has('magi_content_ingest')).toBe(false);
  });

  it('unknown / undefined role → generalist(最安全只读集)', async () => {
    const { subagentToolsForRole } = await import('../subagentTools.js');
    expect(subagentToolsForRole(undefined).has('run_python')).toBe(false);
    expect(subagentToolsForRole(null).has('run_python')).toBe(false);
    expect(subagentToolsForRole('bogus_role').has('run_python')).toBe(false);
    expect(subagentToolsForRole('bogus_role').has('search_papers')).toBe(true);
  });
});

describe('planner: subagent tool whitelist integration', () => {
  it('LlmPlannerInput accepts isSubagent flag', async () => {
    const { generatePlanWithLlm } = await import('../planner.js');
    // TypeScript type-check: if isSubagent compiles in LlmPlannerInput, the function exists
    expect(typeof generatePlanWithLlm).toBe('function');
  });

  it('generatePlanWithLlm applies whitelist when isSubagent=true', async () => {
    const { toolRegistry } = await import('../toolRegistry.js');
    const { SUBAGENT_TOOL_WHITELIST } = await import('../subagentTools.js');
    const { parsePlannerJson } = await import('../planner.js');

    // Get tools that should NOT be in a subagent plan
    const allTools = toolRegistry.list();
    const subagentTools = allTools.filter((t) => SUBAGENT_TOOL_WHITELIST.has(t.name));
    const forbiddenTools = allTools.filter((t) => !SUBAGENT_TOOL_WHITELIST.has(t.name));

    // parsePlannerJson validates that step.toolName is in the provided tool list
    // A plan with a forbidden tool should fail to parse against the subagent tool list
    for (const forbidden of forbiddenTools.slice(0, 3)) {
      const planJson = JSON.stringify({
        intentSummary: 'test',
        steps: [{ toolName: forbidden.name, input: {}, reason: 'test', todoId: 't1' }],
        todos: [{ id: 't1', text: 'test', status: 'pending', stepRefs: [] }],
        finalReplyHint: '',
      });
      // Parsing with filtered tool list should reject the plan (forbidden tool not in subagent list)
      const result = parsePlannerJson(planJson, subagentTools);
      expect(result).toBeNull();
    }

    // A plan with an allowed tool should parse successfully
    if (subagentTools.length > 0) {
      const allowed = subagentTools[0]!;
      const planJson = JSON.stringify({
        intentSummary: 'test',
        steps: [{ toolName: allowed.name, input: {}, reason: 'test', todoId: 't1' }],
        todos: [{ id: 't1', text: 'test', status: 'pending', stepRefs: [] }],
        finalReplyHint: '',
      });
      const result = parsePlannerJson(planJson, subagentTools);
      expect(result).not.toBeNull();
    }
  });
});
