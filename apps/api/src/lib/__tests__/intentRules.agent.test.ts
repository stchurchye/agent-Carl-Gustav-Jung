import { describe, expect, it } from 'vitest';
import { matchSlashCommand, buildCandidatesFromRules } from '../intentRules.js';
import { pickAutoExecute } from '../intentAnalyzer.js';

describe('intentRules: /agent slash command (M1a)', () => {
  it('/agent triggers agent_run intent', () => {
    const match = matchSlashCommand({
      text: '/agent 跑三步 echo',
      channel: 'private',
    });
    expect(match).toBeTruthy();
    expect(match?.candidates[0]?.kind).toBe('agent_run');
    expect(match?.forceChips).toBe(true);
  });

  it('/agent puts agent_run as top candidate in buildCandidatesFromRules', () => {
    const r = buildCandidatesFromRules({
      text: '/agent 帮我跑',
      channel: 'private',
    });
    expect(r.candidates[0]?.kind).toBe('agent_run');
    expect(r.matchedRuleIds).toContain('slash_agent');
  });

  it('non-/agent slash does not trigger agent_run', () => {
    const r = buildCandidatesFromRules({
      text: '/记忆',
      channel: 'private',
    });
    expect(r.candidates[0]?.kind).not.toBe('agent_run');
  });

  it('/agent triggers agent_run in group channel too (M1b-1)', () => {
    const r = buildCandidatesFromRules({
      text: '/agent 帮我研究一下',
      channel: 'group',
    });
    expect(r.candidates[0]?.kind).toBe('agent_run');
    expect(r.matchedRuleIds).toContain('slash_agent');
  });
});

describe('intentRules: agent_run natural-language signals (M1c)', () => {
  it('research request → agent_run primary candidate', () => {
    const r = buildCandidatesFromRules({
      text: '帮我研究下家族信托相关的资料',
      channel: 'private',
    });
    expect(r.candidates[0]?.kind).toBe('agent_run');
    expect(r.matchedRuleIds).toContain('agent_research');
  });

  it('"整理一份报告" matches agent_research', () => {
    const r = buildCandidatesFromRules({
      text: '帮我整理一份关于A股新能源的报告',
      channel: 'private',
    });
    expect(r.candidates[0]?.kind).toBe('agent_run');
  });

  it('memory keyword does NOT match agent_research (sanity)', () => {
    const r = buildCandidatesFromRules({
      text: '记住我喜欢猫',
      channel: 'private',
    });
    expect(r.candidates[0]?.kind).not.toBe('agent_run');
  });

  it('plain url does NOT match agent_research', () => {
    const r = buildCandidatesFromRules({
      text: 'https://example.com/foo',
      channel: 'private',
    });
    expect(r.candidates[0]?.kind).not.toBe('agent_run');
  });
});

/**
 * M1e Task 13.5：把"agent_run 即使 confidence=1.0 也不 autoExecute"
 * 的守卫从废弃的 orchestrator.analyzeIntent 移到 intentAnalyzer.pickAutoExecute。
 * agent run 启动会花钱 + 花时间，必须明确意图 confirm。
 */
describe('intentAnalyzer.pickAutoExecute: agent_run never auto-executes (M1e Task 13.5)', () => {
  it('agent_run with confidence=1.0 still returns autoExecute=false', () => {
    const result = pickAutoExecute(
      [{ kind: 'agent_run', label: 'agent', confidence: 1.0 }],
      false,
    );
    expect(result).toBe(false);
  });

  it('agent_run with confidence=1.0 and weak second still not auto-executed', () => {
    const result = pickAutoExecute(
      [
        { kind: 'agent_run', label: 'agent', confidence: 1.0 },
        { kind: 'chat_private_llm', label: 'chat', confidence: 0.3 },
      ],
      false,
    );
    expect(result).toBe(false);
  });

  it('non-agent intent (chat_private_llm) with high confidence DOES auto-execute (sanity)', () => {
    const result = pickAutoExecute(
      [{ kind: 'chat_private_llm', label: 'chat', confidence: 0.99 }],
      false,
    );
    expect(result).toBe(true);
  });
});
