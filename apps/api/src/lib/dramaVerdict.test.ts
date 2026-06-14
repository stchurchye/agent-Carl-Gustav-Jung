import { describe, expect, it } from 'vitest';
import {
  DRAMA_PASS_MARK,
  DRAMA_SCORE_MAX,
  parseDramaVerdict,
} from './dramaVerdict.js';

describe('parseDramaVerdict:判玩家台词是否达意,服务端夹紧 + 派生 pass', () => {
  it('高分达意 → pass=true,带回应/提示', () => {
    const v = parseDramaVerdict('{"reply":"答应倒有几分胆色。","score":8,"hint":"再恭谨些更好"}');
    expect(v.score).toBe(8);
    expect(v.pass).toBe(true);
    expect(v.reply).toBe('答应倒有几分胆色。');
    expect(v.hint).toBe('再恭谨些更好');
  });

  it('低分不达意 → pass=false', () => {
    const v = parseDramaVerdict('{"reply":"哼,牛头不对马嘴。","score":3}');
    expect(v.pass).toBe(false);
  });

  it('防越狱:LLM 自称 pass:true 但分数低 → 仍判 false(pass 由服务端按分数派生)', () => {
    const v = parseDramaVerdict('{"pass":true,"reply":"准了!","score":2}');
    expect(v.pass).toBe(false);
  });

  it('超大分夹到上限', () => {
    const v = parseDramaVerdict('{"reply":"x","score":999}');
    expect(v.score).toBe(DRAMA_SCORE_MAX);
    expect(v.pass).toBe(true);
  });

  it('负分/非数字 → 0 分、不过', () => {
    expect(parseDramaVerdict('{"reply":"x","score":-5}').score).toBe(0);
    expect(parseDramaVerdict('{"reply":"x","score":"高"}').pass).toBe(false);
  });

  it('没有 JSON:整段当回应、0 分、不过', () => {
    const v = parseDramaVerdict('你这话说得没头没脑。');
    expect(v.reply).toBe('你这话说得没头没脑。');
    expect(v.score).toBe(0);
    expect(v.pass).toBe(false);
  });

  it('及格线常量自洽', () => {
    expect(DRAMA_PASS_MARK).toBeGreaterThan(0);
    expect(DRAMA_PASS_MARK).toBeLessThanOrEqual(DRAMA_SCORE_MAX);
  });
});
