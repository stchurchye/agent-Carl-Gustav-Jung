import { describe, expect, it } from 'vitest';
import { matchSlashCommand, buildCandidatesFromRules } from '../intentRules.js';

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
