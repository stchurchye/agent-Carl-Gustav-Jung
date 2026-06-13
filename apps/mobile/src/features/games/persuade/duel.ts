import { mulberry32, pick } from '../shared/rng';

/** 与服务端 PersuadeMood 对齐 */
export type DuelMood = 'stubborn' | 'annoyed' | 'wavering' | 'won_over';
export type DuelVerdict = { reply: string; scoreDelta: number; mood: DuelMood };
export type DuelTurn = { role: 'dog' | 'player'; text: string };
export type DuelStatus = 'arguing' | 'won' | 'lost';

/** 玩家能使的说服招式 = 狗的软肋/雷区取值域 */
export type Tactic = 'treat' | 'flattery' | 'logic' | 'affection';
export const TACTICS: Tactic[] = ['treat', 'flattery', 'logic', 'affection'];
export const TACTIC_LABEL: Record<Tactic, string> = {
  treat: '零食贿赂',
  flattery: '戴高帽',
  logic: '讲道理',
  affection: '打感情牌',
};

/** 狗的隐藏性情:softSpot 一戳就软,landmine 一碰更犟。玩家靠读破绽猜出来 */
export type Disposition = { softSpot: Tactic; landmine: Tactic };

/** 多汁反馈:把服务端夹紧后的 scoreDelta 翻译成玩家看得懂的反应 */
export type ReactionKind = 'hit' | 'soften' | 'none' | 'annoy' | 'backfire';
export type Reaction = { kind: ReactionKind; label: string };

export function reactionFor(scoreDelta: number): Reaction {
  if (scoreDelta >= 2) return { kind: 'hit', label: `💡 戳中了!固执 -${scoreDelta}` };
  if (scoreDelta === 1) return { kind: 'soften', label: '有点松动… 固执 -1' };
  if (scoreDelta === 0) return { kind: 'none', label: '无动于衷' };
  if (scoreDelta === -1) return { kind: 'annoy', label: '有点不耐烦 固执 +1' };
  return { kind: 'backfire', label: `踩雷了!更犟了 固执 +${-scoreDelta}` };
}

export type DuelState = {
  demand: string;
  /** 狗的性格(喂给提示词 + 决定表情) */
  personality: string;
  /** 隐藏性情:对玩家不直接显示,靠狗的破绽暗示 */
  disposition: Disposition;
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

/** 开一局:按同一条种子流选要求 + 软肋 + 雷区(雷区必与软肋不同) */
export function startDuel(seed: number, personality: string): DuelState {
  const rng = mulberry32(seed);
  const demand = pick(DEMANDS, rng);
  const softSpot = pick(TACTICS, rng);
  const landmine = pick(
    TACTICS.filter((t) => t !== softSpot),
    rng,
  );
  return {
    demand,
    personality,
    disposition: { softSpot, landmine },
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
