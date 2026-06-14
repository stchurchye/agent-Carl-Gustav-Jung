/**
 * 犬朝后宫 · 存档与每幕检查点(纯逻辑,全 TDD)。
 * 八幕剧情长,需要:① 自动续上(关 app 不丢)② 每幕检查点(坏结局回本幕开头,而非从第一幕)。
 * DramaState 本就可序列化;检查点 = 跨入某一幕(场景带 act、首步)那一刻的状态。
 */
import { advanceStory, startStory, type AdvanceInput, type DramaState, type Script } from './story';

export type DramaSave = {
  /** 当前进度 */
  current: DramaState;
  /** 当前所在幕的开头(回本幕用) */
  checkpoint: DramaState;
};

export function initSave(script: Script): DramaSave {
  const s = startStory(script);
  return { current: s, checkpoint: s };
}

/** 是否刚跨入新一幕(场景变了、落在首步、且该场景标了 act) */
function enteredNewAct(script: Script, prev: DramaState, next: DramaState): boolean {
  return next.sceneId !== prev.sceneId && next.stepIndex === 0 && !!script.scenes[next.sceneId]?.act;
}

/** 推进一步并维护存档:跨入新一幕时把检查点推进到该幕开头 */
export function advanceSave(script: Script, save: DramaSave, input?: AdvanceInput): DramaSave {
  const current = advanceStory(script, save.current, input);
  const checkpoint = enteredNewAct(script, save.current, current) ? current : save.checkpoint;
  return { current, checkpoint };
}

/** 回到本幕开头(保留进本幕前挣到的旗标) */
export function restartAct(save: DramaSave): DramaSave {
  return { current: save.checkpoint, checkpoint: save.checkpoint };
}

/** 是否有"可继续"的进度(在玩中,且不在最起点) */
export function isResumable(script: Script, save: DramaSave | null): boolean {
  if (!save) return false;
  const c = save.current;
  if (c.status !== 'playing') return false;
  return c.sceneId !== script.start || c.stepIndex > 0 || c.flags.length > 0;
}

/** 检查点所在幕名(给"继续上次"提示用) */
export function checkpointActLabel(script: Script, save: DramaSave): string | undefined {
  return script.scenes[save.checkpoint.sceneId]?.act;
}

export function serializeSave(save: DramaSave): string {
  return JSON.stringify(save);
}

/** 解析存档;损坏 / 旧版(场景已不存在)→ null,自动作废不崩 */
export function parseSave(raw: string | null, script: Script): DramaSave | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as DramaSave;
    if (!o?.current?.sceneId || !o?.checkpoint?.sceneId) return null;
    if (!script.scenes[o.current.sceneId] || !script.scenes[o.checkpoint.sceneId]) return null;
    return o;
  } catch {
    return null;
  }
}
