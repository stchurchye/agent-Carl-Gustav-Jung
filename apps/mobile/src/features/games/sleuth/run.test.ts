import { SNIFFABLE_ATTRS } from './engine';
import { accuse, sniff, startRun } from './run';

describe('startRun 开局', () => {
  it('第一桩案件:嗅探中、案号 1、已破 0、线索空、剩余嗅探=预算', () => {
    const s = startRun(42);
    expect(s.status).toBe('sniffing');
    expect(s.caseNum).toBe(1);
    expect(s.solved).toBe(0);
    expect(s.clues).toEqual([]);
    expect(s.sniffsLeft).toBeGreaterThan(0);
    expect(s.case.suspects.length).toBeGreaterThanOrEqual(4);
  });

  it('同种子开局可复现', () => {
    expect(startRun(7)).toEqual(startRun(7));
  });
});

describe('sniff 嗅探一个维度', () => {
  it('揭示真凶在该维度的取值、扣一次嗅探、记一条线索', () => {
    const s = startRun(42);
    const culprit = s.case.suspects[s.case.culpritIndex];
    const after = sniff(s, 'ears');
    expect(after.clues).toEqual([{ attr: 'ears', value: culprit.ears }]);
    expect(after.sniffsLeft).toBe(s.sniffsLeft - 1);
  });

  it('同一维度不重复嗅(空操作)', () => {
    const s = sniff(startRun(42), 'ears');
    const again = sniff(s, 'ears');
    expect(again).toBe(s);
  });

  it('嗅探次数耗尽后再嗅是空操作', () => {
    let s = startRun(42);
    let i = 0;
    while (s.sniffsLeft > 0) s = sniff(s, SNIFFABLE_ATTRS[i++]);
    const exhausted = sniff(s, SNIFFABLE_ATTRS[i]);
    expect(exhausted).toBe(s);
  });
});

describe('accuse 指认', () => {
  it('指对真凶:破案 +1、进入下一桩(案号 +1、线索清空、回到嗅探中)', () => {
    const s = sniff(startRun(42), 'ears');
    const next = accuse(s, s.case.culpritIndex);
    expect(next.solved).toBe(1);
    expect(next.caseNum).toBe(2);
    expect(next.clues).toEqual([]);
    expect(next.status).toBe('sniffing');
  });

  it('指错:整局结束、分数不变', () => {
    const s = startRun(42);
    const wrong = (s.case.culpritIndex + 1) % s.case.suspects.length;
    const lost = accuse(s, wrong);
    expect(lost.status).toBe('lost');
    expect(lost.solved).toBe(0);
  });

  it('结束后 sniff/accuse 都空操作', () => {
    const s = startRun(42);
    const wrong = (s.case.culpritIndex + 1) % s.case.suspects.length;
    const lost = accuse(s, wrong);
    expect(sniff(lost, 'coat')).toBe(lost);
    expect(accuse(lost, lost.case.culpritIndex)).toBe(lost);
  });
});
