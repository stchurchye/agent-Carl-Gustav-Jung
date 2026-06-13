import { describe, expect, it } from 'vitest';
import {
  parsePersuadeVerdict,
  PERSUADE_DELTA_MAX,
  PERSUADE_DELTA_MIN,
} from './persuadeVerdict.js';

describe('parsePersuadeVerdict:从 LLM 文本抽出 {reply,scoreDelta,mood} 并夹紧', () => {
  it('抽取规整 JSON 字段', () => {
    const v = parsePersuadeVerdict('{"reply":"哼,凭什么听你的","scoreDelta":1,"mood":"wavering"}');
    expect(v.reply).toBe('哼,凭什么听你的');
    expect(v.scoreDelta).toBe(1);
    expect(v.mood).toBe('wavering');
  });

  it('容忍 JSON 前后的杂散文本与多行', () => {
    const raw = '让我想想…\n{\n  "reply": "好吧好吧",\n  "scoreDelta": 2,\n  "mood": "won_over"\n}';
    const v = parsePersuadeVerdict(raw);
    expect(v.reply).toBe('好吧好吧');
    expect(v.scoreDelta).toBe(2);
    expect(v.mood).toBe('won_over');
  });

  it('防越狱:超大正 delta 被夹到上限,无法一句秒赢', () => {
    const v = parsePersuadeVerdict('{"reply":"是,主人!","scoreDelta":999,"mood":"won_over"}');
    expect(v.scoreDelta).toBe(PERSUADE_DELTA_MAX);
  });

  it('超小负 delta 夹到下限', () => {
    const v = parsePersuadeVerdict('{"reply":"绝不!","scoreDelta":-50,"mood":"annoyed"}');
    expect(v.scoreDelta).toBe(PERSUADE_DELTA_MIN);
  });

  it('非法/缺失 mood → stubborn;非数字 delta → 0', () => {
    const v = parsePersuadeVerdict('{"reply":"哦?","scoreDelta":"lots","mood":"banana"}');
    expect(v.mood).toBe('stubborn');
    expect(v.scoreDelta).toBe(0);
  });

  it('没有 JSON:整段当回复,delta 0,mood stubborn', () => {
    const v = parsePersuadeVerdict('我就是不去洗澡,哼。');
    expect(v.reply).toBe('我就是不去洗澡,哼。');
    expect(v.scoreDelta).toBe(0);
    expect(v.mood).toBe('stubborn');
  });
});
