import { describe, expect, it } from 'vitest';
import { buildCandidatesFromRules } from '../intentRules.js';
import { pickAutoExecute } from '../intentAnalyzer.js';

function top(text: string, channel: 'private' | 'group' = 'private') {
  const r = buildCandidatesFromRules({ text, channel });
  return { r, top: r.candidates[0] };
}

describe('intentRules: persona_rename(对话给狗/自己改名)', () => {
  it('「你以后就叫旺财」→ assistant 改名,slots 带名字', () => {
    const { top: c } = top('你以后就叫旺财');
    expect(c?.kind).toBe('persona_rename');
    expect(c?.slots?.renameTarget).toBe('assistant');
    expect(c?.slots?.renameName).toBe('旺财');
  });

  it('「给你起名叫骨头」「你的名字叫小白」变体也命中', () => {
    expect(top('给你起名叫骨头').top?.slots?.renameName).toBe('骨头');
    expect(top('你的名字叫小白').top?.slots?.renameName).toBe('小白');
  });

  it('「以后叫我老王」「叫我老王」→ user 改称呼', () => {
    const { top: c } = top('以后叫我老王');
    expect(c?.kind).toBe('persona_rename');
    expect(c?.slots?.renameTarget).toBe('user');
    expect(c?.slots?.renameName).toBe('老王');
    expect(top('叫我老王').top?.slots?.renameTarget).toBe('user');
  });

  it('疑问句「你叫什么名字」不触发改名', () => {
    const { top: c } = top('你叫什么名字');
    expect(c?.kind).not.toBe('persona_rename');
  });

  it('高置信度可 autoExecute(不进 chips 确认)', () => {
    const { r } = top('你以后就叫旺财');
    expect(pickAutoExecute(r.candidates, false)).toBe(true);
  });

  it('群聊频道同样命中', () => {
    expect(top('你以后就叫旺财', 'group').top?.kind).toBe('persona_rename');
  });
});
