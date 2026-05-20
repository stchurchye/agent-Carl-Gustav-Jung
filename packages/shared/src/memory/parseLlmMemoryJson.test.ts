import { describe, expect, it } from 'vitest';
import {
  lastNonEmptyLine,
  parseAutoExtractCandidates,
  parsePreCompactCandidates,
} from './parseLlmMemoryJson.js';

describe('lastNonEmptyLine', () => {
  it('takes the last non-empty line from multiline LLM output', () => {
    const raw = `说明文字
{"candidates":[]}
`;
    expect(lastNonEmptyLine(raw)).toBe('{"candidates":[]}');
  });
});

describe('parseAutoExtractCandidates', () => {
  it('parses valid candidates and filters low confidence', () => {
    const raw =
      '{"candidates":[{"title":"语气","content":"说话温柔一点","scope":"user","category":"user_profile","confidence":0.9},{"title":"噪声","content":"无关","confidence":0.2}]}';
    const out = parseAutoExtractCandidates(raw, { defaultScope: 'session' });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      title: '语气',
      scope: 'user',
      category: 'user_profile',
      confidence: 0.9,
    });
  });

  it('defaults scope to session for private chat', () => {
    const raw =
      '{"candidates":[{"content":"记住用 TypeScript","confidence":0.7}]}';
    const out = parseAutoExtractCandidates(raw, { defaultScope: 'session' });
    expect(out[0]?.scope).toBe('user');
  });

  it('defaults scope to topic for group chat unless user scope', () => {
    const raw =
      '{"candidates":[{"content":"本话题用 pnpm","scope":"topic","confidence":0.8}]}';
    const out = parseAutoExtractCandidates(raw, { defaultScope: 'topic' });
    expect(out[0]?.scope).toBe('topic');
  });

  it('returns empty array on invalid JSON', () => {
    expect(parseAutoExtractCandidates('not json')).toEqual([]);
  });
});

describe('parsePreCompactCandidates', () => {
  it('parses up to two salvage candidates', () => {
    const raw =
      '{"candidates":[{"title":"决定","content":"下周用 RN 重构","category":"project_note"},{"title":"偏好","content":"回复要简短","category":"user_profile"},{"title":"多余","content":"应被截断","category":"general"}]}';
    const out = parsePreCompactCandidates(raw);
    expect(out).toHaveLength(2);
    expect(out[0]?.category).toBe('project_note');
  });
});
