import { ACT1 } from './script';
import { CAST } from './cast';
import { SCENE_GRIDS } from '../../../pixel/grids/dramaScenes';
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

  it('在场角色与所有说话人(对白/说台词/辩论发难)都在角色表里', () => {
    const bad: string[] = [];
    const checkWho = (sid: string, who: string | undefined, tag: string) => {
      if (who && !CAST[who]) bad.push(`${sid} ${tag}:${who}`);
    };
    for (const scene of Object.values(ACT1.scenes)) {
      for (const id of scene.cast) if (!CAST[id]) bad.push(`${scene.id} cast:${id}`);
      for (const step of scene.steps) {
        if (step.kind === 'line') checkWho(scene.id, step.who, 'who');
        if (step.kind === 'sayline') checkWho(scene.id, step.who, 'say');
        if (step.kind === 'debate') {
          checkWho(scene.id, step.who, 'debate');
          for (const r of step.rounds) checkWho(scene.id, r.who, 'round');
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('每个场景的 bg 都在 SCENE_GRIDS 里(防 typo 静默回退到 hall)', () => {
    const keys = new Set(Object.keys(SCENE_GRIDS));
    const bad = Object.values(ACT1.scenes)
      .filter((s) => !keys.has(s.bg))
      .map((s) => `${s.id}:${s.bg}`);
    expect(bad).toEqual([]);
  });
});
