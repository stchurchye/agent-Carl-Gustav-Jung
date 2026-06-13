/** 犬朝后宫:剧情图引擎。场景 DAG + 旗标分支的纯 reducer,与渲染/LLM/美术解耦,便于 TDD。 */

export type CharId = string;
export type SceneId = string;

/** 一句台词 */
export type Line = { kind: 'line'; who: CharId; text: string; mood?: string };
/** 选项:可置旗标、可跳场景(无 goto 则进本场景下一步) */
export type ChoiceOption = { label: string; setFlags?: string[]; goto?: SceneId };
export type Choice = { kind: 'choice'; prompt?: string; options: ChoiceOption[] };
/** 说对台词:玩家说的话经 LLM 判定 pass/fail → 走不同场景 */
export type SayLine = {
  kind: 'sayline';
  who: CharId;
  /** 戏剧意图(喂给判官,不直接显示) */
  intent: string;
  hint?: string;
  onPass?: SceneId;
  onFail?: SceneId;
};
/** 查案推理(D3 接嗅探引擎):solved/fail → 走不同场景 */
export type Deduce = { kind: 'deduce'; onSolve?: SceneId; onFail?: SceneId };
export type Ending = { kind: 'ending'; outcome: 'good' | 'bad'; text: string };

export type Step = Line | Choice | SayLine | Deduce | Ending;

export type Scene = {
  id: SceneId;
  /** 场景背景 key(对应像素场景) */
  bg: string;
  /** 在场角色 id */
  cast: CharId[];
  steps: Step[];
  /** 步骤走完后接续的场景(无则停在原地) */
  goto?: SceneId;
};

export type Script = { start: SceneId; scenes: Record<SceneId, Scene> };

export type DramaStatus = 'playing' | 'won' | 'lost';
export type DramaState = {
  sceneId: SceneId;
  stepIndex: number;
  flags: string[];
  status: DramaStatus;
};

/** 玩家在当前步的输入(按步类型取相应字段) */
export type AdvanceInput = { choice?: number; pass?: boolean; solved?: boolean };

export function currentStep(script: Script, state: DramaState): Step | null {
  return script.scenes[state.sceneId]?.steps[state.stepIndex] ?? null;
}

/** 落到 ending 步时据 outcome 定 status,否则 playing */
function withStatus(script: Script, state: DramaState): DramaState {
  const step = currentStep(script, state);
  const status: DramaStatus =
    step?.kind === 'ending' ? (step.outcome === 'good' ? 'won' : 'lost') : 'playing';
  return state.status === status ? state : { ...state, status };
}

function gotoScene(state: DramaState, sceneId: SceneId): DramaState {
  return { ...state, sceneId, stepIndex: 0 };
}

/** 本场景下一步;走完则接 scene.goto;无 goto 则原地不动 */
function nextStep(script: Script, state: DramaState): DramaState {
  const scene = script.scenes[state.sceneId];
  if (state.stepIndex + 1 < scene.steps.length) {
    return { ...state, stepIndex: state.stepIndex + 1 };
  }
  return scene.goto ? gotoScene(state, scene.goto) : state;
}

function target(script: Script, state: DramaState, sceneId: SceneId | undefined): DramaState {
  return sceneId ? gotoScene(state, sceneId) : nextStep(script, state);
}

/** 开一局:从 start 场景第 0 步 */
export function startStory(script: Script): DramaState {
  return withStatus(script, { sceneId: script.start, stepIndex: 0, flags: [], status: 'playing' });
}

/** 推进一步;结束态空操作。input 按当前步类型取字段 */
export function advanceStory(script: Script, state: DramaState, input?: AdvanceInput): DramaState {
  if (state.status !== 'playing') return state;
  const step = currentStep(script, state);
  if (!step) return state;

  let next: DramaState;
  switch (step.kind) {
    case 'line':
      next = nextStep(script, state);
      break;
    case 'choice': {
      const opt = step.options[input?.choice ?? -1];
      if (!opt) return state;
      const flags = opt.setFlags ? Array.from(new Set([...state.flags, ...opt.setFlags])) : state.flags;
      next = target(script, { ...state, flags }, opt.goto);
      break;
    }
    case 'sayline':
      next = target(script, state, input?.pass ? step.onPass : step.onFail);
      break;
    case 'deduce':
      next = target(script, state, input?.solved ? step.onSolve : step.onFail);
      break;
    case 'ending':
      return state;
  }
  return withStatus(script, next);
}
