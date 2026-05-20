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
