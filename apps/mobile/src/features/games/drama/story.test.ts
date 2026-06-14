import { advanceStory, currentStep, startStory, type Script } from './story';

/** 纯结构测试夹具(占位剧情,真内容在 D5) */
const SCRIPT: Script = {
  start: 's1',
  scenes: {
    s1: {
      id: 's1',
      bg: 'hall',
      cast: ['hero'],
      steps: [
        { kind: 'line', who: 'hero', text: '开场' },
        {
          kind: 'choice',
          options: [
            { label: '行礼', setFlags: ['polite'], goto: 's2' },
            { label: '无视', goto: 's3' },
          ],
        },
      ],
    },
    s2: {
      id: 's2',
      bg: 'hall',
      cast: ['hero', 'rival'],
      steps: [{ kind: 'sayline', who: 'rival', intent: '自报家门', onPass: 'sGood', onFail: 'sBad' }],
    },
    s3: {
      id: 's3',
      bg: 'garden',
      cast: ['hero'],
      steps: [{ kind: 'deduce', onSolve: 'sGood', onFail: 'sBad' }],
    },
    sGood: { id: 'sGood', bg: 'hall', cast: [], steps: [{ kind: 'ending', outcome: 'good', text: '圆满' }] },
    sBad: { id: 'sBad', bg: 'hall', cast: [], steps: [{ kind: 'ending', outcome: 'bad', text: '出局' }] },
  },
};

describe('startStory / currentStep', () => {
  it('从 start 场景第 0 步、旗标空、进行中', () => {
    const s = startStory(SCRIPT);
    expect(s).toEqual({ sceneId: 's1', stepIndex: 0, flags: [], status: 'playing' });
    expect(currentStep(SCRIPT, s)).toEqual({ kind: 'line', who: 'hero', text: '开场' });
  });
});

describe('advanceStory:对白推进', () => {
  it('line → 下一步', () => {
    const s = advanceStory(SCRIPT, startStory(SCRIPT));
    expect(s.sceneId).toBe('s1');
    expect(s.stepIndex).toBe(1);
    expect(currentStep(SCRIPT, s)?.kind).toBe('choice');
  });
});

describe('advanceStory:选择分支 + 旗标', () => {
  it('选项置旗标并跳场景', () => {
    let s = advanceStory(SCRIPT, startStory(SCRIPT)); // 到 choice
    s = advanceStory(SCRIPT, s, { choice: 0 }); // 行礼
    expect(s.flags).toContain('polite');
    expect(s.sceneId).toBe('s2');
    expect(s.stepIndex).toBe(0);
  });
  it('另一选项走另一分支', () => {
    let s = advanceStory(SCRIPT, startStory(SCRIPT));
    s = advanceStory(SCRIPT, s, { choice: 1 }); // 无视
    expect(s.sceneId).toBe('s3');
    expect(s.flags).not.toContain('polite');
  });
});

describe('advanceStory:说台词 / 查案 分支 + 结局状态', () => {
  function atSayline() {
    let s = advanceStory(SCRIPT, startStory(SCRIPT));
    return advanceStory(SCRIPT, s, { choice: 0 }); // → s2 sayline
  }
  it('说对 → 好结局(won)', () => {
    const s = advanceStory(SCRIPT, atSayline(), { pass: true });
    expect(s.sceneId).toBe('sGood');
    expect(s.status).toBe('won');
  });
  it('说错 → 坏结局(lost)', () => {
    const s = advanceStory(SCRIPT, atSayline(), { pass: false });
    expect(s.sceneId).toBe('sBad');
    expect(s.status).toBe('lost');
  });

  function atDeduce() {
    let s = advanceStory(SCRIPT, startStory(SCRIPT));
    return advanceStory(SCRIPT, s, { choice: 1 }); // → s3 deduce
  }
  it('查对 → 好结局', () => {
    expect(advanceStory(SCRIPT, atDeduce(), { solved: true }).status).toBe('won');
  });
  it('查错 → 坏结局', () => {
    expect(advanceStory(SCRIPT, atDeduce(), { solved: false }).status).toBe('lost');
  });

  it('结局后再 advance 空操作', () => {
    const won = advanceStory(SCRIPT, atSayline(), { pass: true });
    expect(advanceStory(SCRIPT, won)).toBe(won);
  });
});

describe('advanceStory:branch 按旗标自动分支', () => {
  const S: Script = {
    start: 'a',
    scenes: {
      a: {
        id: 'a',
        bg: 'x',
        cast: [],
        steps: [
          {
            kind: 'choice',
            options: [
              { label: '信', setFlags: ['trust'], goto: 'b' },
              { label: '疑', goto: 'b' },
            ],
          },
        ],
      },
      b: { id: 'b', bg: 'x', cast: [], steps: [{ kind: 'branch', flag: 'trust', whenSet: 'good', whenUnset: 'bad' }] },
      good: { id: 'good', bg: 'x', cast: [], steps: [{ kind: 'ending', outcome: 'good', text: '好' }] },
      bad: { id: 'bad', bg: 'x', cast: [], steps: [{ kind: 'ending', outcome: 'bad', text: '坏' }] },
    },
  };
  it('旗标置位 → whenSet', () => {
    let s = advanceStory(S, startStory(S), { choice: 0 });
    s = advanceStory(S, s);
    expect(s.sceneId).toBe('good');
    expect(s.status).toBe('won');
  });
  it('旗标未置 → whenUnset', () => {
    let s = advanceStory(S, startStory(S), { choice: 1 });
    s = advanceStory(S, s);
    expect(s.sceneId).toBe('bad');
    expect(s.status).toBe('lost');
  });
});

describe('advanceStory:场景内走完靠 scene.goto 接续', () => {
  const LINEAR: Script = {
    start: 'a',
    scenes: {
      a: { id: 'a', bg: 'x', cast: [], steps: [{ kind: 'line', who: 'n', text: '甲' }], goto: 'b' },
      b: { id: 'b', bg: 'x', cast: [], steps: [{ kind: 'ending', outcome: 'good', text: '终' }] },
    },
  };
  it('line 走完场景 → 跳 scene.goto', () => {
    const s = advanceStory(LINEAR, startStory(LINEAR));
    expect(s.sceneId).toBe('b');
    expect(s.status).toBe('won');
  });
});
