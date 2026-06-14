import {
  initSave,
  advanceSave,
  restartAct,
  isResumable,
  checkpointActLabel,
  serializeSave,
  parseSave,
  type DramaSave,
} from './dramaSave';
import { ACT1 } from './script';
import type { Script } from './story';

/** 小夹具:两幕、各带 act 标记,便于测检查点 */
const S: Script = {
  start: 'a1',
  scenes: {
    a1: {
      id: 'a1',
      bg: 'hall',
      act: '第一幕',
      cast: [],
      steps: [
        { kind: 'line', who: 'x', text: '一' },
        { kind: 'choice', options: [{ label: '去二幕', setFlags: ['f'], goto: 'a2' }] },
      ],
    },
    a2: {
      id: 'a2',
      bg: 'hall',
      act: '第二幕',
      cast: [],
      steps: [
        { kind: 'line', who: 'x', text: '二' },
        { kind: 'line', who: 'x', text: '二之二' },
      ],
    },
  },
};

describe('犬朝后宫 存档 + 每幕检查点', () => {
  it('initSave:当前与检查点都在起点', () => {
    const s = initSave(S);
    expect(s.current.sceneId).toBe('a1');
    expect(s.checkpoint.sceneId).toBe('a1');
  });

  it('幕内推进不动检查点;跨入新一幕则检查点推进到该幕开头', () => {
    let save = initSave(S);
    save = advanceSave(S, save); // a1 line → a1 choice(幕内)
    expect(save.checkpoint.sceneId).toBe('a1');
    save = advanceSave(S, save, { choice: 0 }); // 选「去二幕」→ a2 首步(跨幕)
    expect(save.current.sceneId).toBe('a2');
    expect(save.checkpoint.sceneId).toBe('a2'); // 检查点推进到第二幕开头
    expect(save.checkpoint.flags).toContain('f'); // 保留了进幕前挣的旗标
  });

  it('restartAct:回到本幕开头,保留之前旗标', () => {
    let save = advanceSave(S, advanceSave(S, initSave(S)), { choice: 0 }); // 到 a2 首步
    save = advanceSave(S, save); // a2 内推进一步
    expect(save.current.stepIndex).toBe(1);
    const back = restartAct(save);
    expect(back.current.sceneId).toBe('a2');
    expect(back.current.stepIndex).toBe(0); // 回本幕开头
    expect(back.current.flags).toContain('f');
  });

  it('isResumable:起点不算,推进过/有旗标才算;结束态不算', () => {
    expect(isResumable(S, initSave(S))).toBe(false);
    const moved = advanceSave(S, initSave(S));
    expect(isResumable(S, moved)).toBe(true);
    const ended: DramaSave = { ...moved, current: { ...moved.current, status: 'lost' } };
    expect(isResumable(S, ended)).toBe(false);
    expect(isResumable(S, null)).toBe(false);
  });

  it('checkpointActLabel 给出本幕名', () => {
    const save = advanceSave(S, advanceSave(S, initSave(S)), { choice: 0 });
    expect(checkpointActLabel(S, save)).toBe('第二幕');
  });

  it('序列化/解析往返;损坏或旧版(场景不存在)→ null', () => {
    const save = advanceSave(S, initSave(S));
    expect(parseSave(serializeSave(save), S)).toEqual(save);
    expect(parseSave('{bad json', S)).toBeNull();
    expect(parseSave(null, S)).toBeNull();
    const stale = JSON.stringify({ current: { sceneId: 'gone', stepIndex: 0, flags: [], status: 'playing' }, checkpoint: { sceneId: 'gone', stepIndex: 0, flags: [], status: 'playing' } });
    expect(parseSave(stale, S)).toBeNull();
  });

  it('真本(ACT1)跑一段后存档可续、检查点跟着幕走', () => {
    let save = initSave(ACT1); // gate(第一幕)
    expect(checkpointActLabel(ACT1, save)).toBe('第一幕 · 初入宫闱');
    save = advanceSave(ACT1, save); // gate line1 → line2(幕内)
    expect(save.checkpoint.sceneId).toBe('gate');
    expect(isResumable(ACT1, save)).toBe(true);
  });
});
