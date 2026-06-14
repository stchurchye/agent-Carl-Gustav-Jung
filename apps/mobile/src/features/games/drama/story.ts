/** 犬朝后宫:剧情图引擎。场景 DAG + 旗标分支的纯 reducer,与渲染/LLM/美术解耦,便于 TDD。 */

export type CharId = string;
export type SceneId = string;

/** 一句台词 */
export type Line = { kind: 'line'; who: CharId; text: string; mood?: string };
/** 选项:可置旗标、可跳场景(无 goto 则进本场景下一步) */
export type ChoiceOption = { label: string; setFlags?: string[]; goto?: SceneId };
export type Choice = { kind: 'choice'; prompt?: string; options: ChoiceOption[] };
/** 一个可选的应对台词(多选题模式);good=得体能过,reply=选错时对面的回怼 */
export type SayOption = { label: string; good: boolean; reply?: string };
/**
 * 说对台词:
 *  - 给了 options → 多选题模式(挑一句得体的,挑对即过,纯离线、不连 LLM)
 *  - 没给 options → 自由打字 + LLM 判官模式
 */
export type SayLine = {
  kind: 'sayline';
  who: CharId;
  /** 戏剧意图(喂给判官,不直接显示给玩家) */
  intent: string;
  /** 场景情境(喂给判官做背景) */
  context?: string;
  hint?: string;
  /** 多选题选项;有则走多选、不连 LLM */
  options?: SayOption[];
  onPass?: SceneId;
  onFail?: SceneId;
};
/** 查案推理(接嗅探引擎):嗅线索揪真凶,猜错=fail。难度由 count/budget 调 */
export type Deduce = {
  kind: 'deduce';
  /** 案情引子(剧情框) */
  prompt?: string;
  /** 嫌疑狗数(默认 6,比现版难) */
  count?: number;
  /** 嗅探次数预算(默认 2,比现版紧) */
  budget?: number;
  /** 固定种子(可复现);缺省随机 */
  seed?: number;
  onSolve?: SceneId;
  onFail?: SceneId;
};
/** 推箱子脱困:把宫箱全推上地砖机关、暗门即开。解开=onSolve;放弃突围=onFail */
export type Sokoban = {
  kind: 'sokoban';
  prompt?: string;
  /** 关卡(Sokoban 记法字符网格);缺省用库房关卡 */
  level?: string[];
  onSolve?: SceneId;
  onFail?: SceneId;
};
/** 验毒配伍:逻辑约束网格,凭医案标注全部药对的安/烈,呈对=onSolve、标错/弃局=onFail */
export type Pairing = {
  kind: 'pairing';
  prompt?: string;
  n?: number;
  clueBudget?: number;
  useCounts?: boolean;
  seed?: number;
  onSolve?: SceneId;
  onFail?: SceneId;
};
/** 月下夜探:回合制潜行,避开巡夜犬视锥摸到目标。脱困=onSolve、被发现/弃行=onFail */
export type Prowl = { kind: 'prowl'; prompt?: string; onSolve?: SceneId; onFail?: SceneId };
/** 默宫仪:宫礼版 Simon,复现示范、跳过诈仪禁手。通仪=onSolve、失仪/告退=onFail */
export type Koulli = {
  kind: 'koulli';
  prompt?: string;
  length?: number;
  paletteSize?: number;
  seed?: number;
  revealTrap?: boolean; // 标出禁手(守礼者得老福暗点 → 降难)
  onSolve?: SceneId;
  onFail?: SceneId;
};
/** 听更夜奏:更鼓节拍抚弦,亮拍拨弦、留白屏息。通仪=onSolve、失态/搁琴=onFail */
export type Zither = { kind: 'zither'; prompt?: string; onSolve?: SceneId; onFail?: SceneId };
/** 公堂辩论:逐轮择驳词对垒气势。压服全场=onWin、落于下风/被驳哑=onLose;各轮内容在 rounds */
export type Debate = {
  kind: 'debate';
  prompt?: string;
  /** 主发难者(舞台高亮它)——多轮发难通常同一人 */
  who?: CharId;
  rounds: import('./debate').DebateRound[];
  onWin?: SceneId;
  onLose?: SceneId;
};
export type Ending = { kind: 'ending'; outcome: 'good' | 'bad'; text: string };
/** 旗标条件分支(无玩家输入,自动按旗标走);让选择产生后果 */
export type Branch = { kind: 'branch'; flag: string; whenSet?: SceneId; whenUnset?: SceneId };

export type Step =
  | Line
  | Choice
  | SayLine
  | Deduce
  | Sokoban
  | Pairing
  | Prowl
  | Koulli
  | Zither
  | Debate
  | Branch
  | Ending;

export type Scene = {
  id: SceneId;
  /** 场景背景 key(对应像素场景) */
  bg: string;
  /** 在场角色 id */
  cast: CharId[];
  steps: Step[];
  /** 步骤走完后接续的场景(无则停在原地) */
  goto?: SceneId;
  /** 幕开场标题(如「第三幕 · 棠梨惊变」);设了则进此场景时在舞台顶部亮一道过场横幅 */
  act?: string;
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
    case 'sokoban':
      next = target(script, state, input?.solved ? step.onSolve : step.onFail);
      break;
    case 'pairing':
      next = target(script, state, input?.solved ? step.onSolve : step.onFail);
      break;
    case 'prowl':
      next = target(script, state, input?.solved ? step.onSolve : step.onFail);
      break;
    case 'koulli':
      next = target(script, state, input?.solved ? step.onSolve : step.onFail);
      break;
    case 'zither':
      next = target(script, state, input?.solved ? step.onSolve : step.onFail);
      break;
    case 'debate':
      next = target(script, state, input?.solved ? step.onWin : step.onLose);
      break;
    case 'branch':
      next = target(script, state, state.flags.includes(step.flag) ? step.whenSet : step.whenUnset);
      break;
    case 'ending':
      return state;
  }
  return withStatus(script, next);
}
