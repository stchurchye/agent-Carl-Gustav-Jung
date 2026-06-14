import { ACT1 } from './script';
import { CAST } from './cast';
import type { Scene, Step } from './story';

/** 一个场景所有可能跳转到的目标场景 id */
function targetsOf(scene: Scene): string[] {
  const t: string[] = [];
  if (scene.goto) t.push(scene.goto);
  for (const step of scene.steps as Step[]) {
    if (step.kind === 'choice') for (const o of step.options) if (o.goto) t.push(o.goto);
    if (step.kind === 'sayline') {
      if (step.onPass) t.push(step.onPass);
      if (step.onFail) t.push(step.onFail);
    }
    if (
      step.kind === 'deduce' ||
      step.kind === 'sokoban' ||
      step.kind === 'pairing' ||
      step.kind === 'prowl' ||
      step.kind === 'koulli' ||
      step.kind === 'zither'
    ) {
      if (step.onSolve) t.push(step.onSolve);
      if (step.onFail) t.push(step.onFail);
    }
    if (step.kind === 'debate') {
      if (step.onWin) t.push(step.onWin);
      if (step.onLose) t.push(step.onLose);
    }
    if (step.kind === 'branch') {
      if (step.whenSet) t.push(step.whenSet);
      if (step.whenUnset) t.push(step.whenUnset);
    }
  }
  return t;
}

function reachableFromStart(): Set<string> {
  const seen = new Set<string>([ACT1.start]);
  const q = [ACT1.start];
  while (q.length) {
    const id = q.shift()!;
    for (const t of targetsOf(ACT1.scenes[id])) if (!seen.has(t)) seen.add(t), q.push(t);
  }
  return seen;
}

describe('ACT1 剧情图完整性', () => {
  const ids = new Set(Object.keys(ACT1.scenes));

  it('start 存在,且所有跳转目标都指向存在的场景', () => {
    expect(ids.has(ACT1.start)).toBe(true);
    const bad: string[] = [];
    for (const scene of Object.values(ACT1.scenes))
      for (const t of targetsOf(scene)) if (!ids.has(t)) bad.push(`${scene.id} → ${t}`);
    expect(bad).toEqual([]);
  });

  it('每个场景都从 start 可达(无孤岛)', () => {
    const seen = reachableFromStart();
    expect([...ids].filter((id) => !seen.has(id))).toEqual([]);
  });

  it('存在可达的好结局与坏结局', () => {
    const seen = reachableFromStart();
    const outcomes = [...seen].flatMap((id) =>
      ACT1.scenes[id].steps.filter((s): s is Extract<Step, { kind: 'ending' }> => s.kind === 'ending').map((s) => s.outcome),
    );
    expect(outcomes).toContain('good');
    expect(outcomes).toContain('bad');
  });

  it('在场角色与台词说话人都在角色表里', () => {
    const bad: string[] = [];
    for (const scene of Object.values(ACT1.scenes)) {
      for (const id of scene.cast) if (!CAST[id]) bad.push(`${scene.id} cast:${id}`);
      for (const step of scene.steps) if (step.kind === 'line' && !CAST[step.who]) bad.push(`${scene.id} who:${step.who}`);
    }
    expect(bad).toEqual([]);
  });
});
