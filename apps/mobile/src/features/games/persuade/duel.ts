import { mulberry32, pick } from '../shared/rng';

/** 与服务端 PersuadeMood 对齐 */
export type DuelMood = 'stubborn' | 'annoyed' | 'wavering' | 'won_over';
export type DuelVerdict = { reply: string; scoreDelta: number; mood: DuelMood };
export type DuelTurn = { role: 'dog' | 'player'; text: string };
export type DuelStatus = 'arguing' | 'won' | 'lost';

export type DuelState = {
  demand: string;
  /** 狗的性格(喂给提示词 + 决定表情) */
  personality: string;
  /** 固执值,降到 ≤0 即被说服 */
  stubbornness: number;
  turnsLeft: number;
  history: DuelTurn[];
  mood: DuelMood;
  status: DuelStatus;
};

export const DUEL_START_STUBBORNNESS = 6;
export const DUEL_TURNS = 5;

/** 主人想让狗干的事(随机一桩) */
const DEMANDS = ['去洗澡', '把骨头还给猫', '别追猫了', '该睡觉啦', '把鞋子吐出来', '过来打针', '把玩具收好'];

/** 开一局:按种子选一桩要求 */
export function startDuel(seed: number, personality: string): DuelState {
  return {
    demand: pick(DEMANDS, mulberry32(seed)),
    personality,
    stubbornness: DUEL_START_STUBBORNNESS,
    turnsLeft: DUEL_TURNS,
    history: [],
    mood: 'stubborn',
    status: 'arguing',
  };
}

/**
 * 一回合:玩家说一句 + 狗(LLM)的裁决。
 * 正 scoreDelta 降固执;固执 ≤0 → 赢;回合耗尽仍 >0 → 输。结束后空操作。
 */
export function applyTurn(state: DuelState, playerLine: string, verdict: DuelVerdict): DuelState {
  if (state.status !== 'arguing') return state;
  const stubbornness = state.stubbornness - verdict.scoreDelta;
  const turnsLeft = state.turnsLeft - 1;
  const history: DuelTurn[] = [
    ...state.history,
    { role: 'player', text: playerLine },
    { role: 'dog', text: verdict.reply },
  ];
  const status: DuelStatus = stubbornness <= 0 ? 'won' : turnsLeft <= 0 ? 'lost' : 'arguing';
  return { ...state, stubbornness, turnsLeft, history, mood: verdict.mood, status };
}
