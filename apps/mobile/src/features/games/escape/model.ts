/** 狗狗越狱:声音(麦克风振幅)= 狗绳。喊得越响,抓力越大,把狗往回拽;一安静它就冲门。 */

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/**
 * ESR volumechange 的 value(-2..10,<0 视为无声)→ 抓力 0..1。
 * 按“校准上限”线性映射:raw/max 夹到 [0,1];max≤0 或 raw≤0 → 0。
 */
export function normalizeLoudness(raw: number, calibratedMax: number): number {
  if (raw <= 0 || calibratedMax <= 0) return 0;
  return clamp01(raw / calibratedMax);
}

/** 指数滑动平均:prev 向 next 靠拢 alpha(平滑抖动的振幅读数) */
export function ema(prev: number, next: number, alpha: number): number {
  return prev + alpha * (next - prev);
}

export const ESCAPE_TUNING = {
  /** 狗的起始位置(0=安全起点,1=门口=逃脱) */
  startPosition: 0.12,
  /** 安静时狗向门前进的初速(每秒) */
  baseEscapeSpeed: 0.085,
  /** 前进速度随时间加快(每秒) */
  speedRampPerSec: 0.006,
  /** 满抓力(grip=1)时的最大回拽速度(每秒) */
  gripPull: 0.32,
  /** 振幅平滑系数 */
  emaAlpha: 0.35,
  /** 校准上限地板:安静房间也能玩 */
  minCalibratedMax: 1.5,
  /** 开局校准时长(ms) */
  calibrateMs: 2000,
};

export type EscapePhase = 'calibrating' | 'playing' | 'escaped';

/** 一局越狱的全部状态(纯数据,便于 TDD 与渲染分离) */
export type EscapeState = {
  phase: EscapePhase;
  /** 0 安全 … 1 逃脱 */
  position: number;
  /** 平滑后的抓力 0..1 */
  grip: number;
  /** 校准得到的喊声上限(原始振幅) */
  calibratedMax: number;
  /** 当前前进速度(随时间 ramp) */
  escapeSpeed: number;
  /** 已坚持时长(ms)= 分数 */
  elapsedMs: number;
};

/** 开一局:进入校准阶段 */
export function startEscape(): EscapeState {
  return {
    phase: 'calibrating',
    position: ESCAPE_TUNING.startPosition,
    grip: 0,
    calibratedMax: 0,
    escapeSpeed: ESCAPE_TUNING.baseEscapeSpeed,
    elapsedMs: 0,
  };
}

/**
 * 喂入一帧麦克风振幅:
 * - 校准期:把见过的最大振幅记为上限,并按运行上限抬升抓力(让仪表有反馈);
 * - 游戏期:按校准上限归一,EMA 平滑成抓力;
 * - 逃脱后:空操作。
 */
export function observeLoudness(state: EscapeState, raw: number): EscapeState {
  if (state.phase === 'escaped') return state;
  if (state.phase === 'calibrating') {
    const calibratedMax = Math.max(state.calibratedMax, raw);
    const grip = ema(state.grip, normalizeLoudness(raw, calibratedMax), ESCAPE_TUNING.emaAlpha);
    return { ...state, calibratedMax, grip };
  }
  const grip = ema(state.grip, normalizeLoudness(raw, state.calibratedMax), ESCAPE_TUNING.emaAlpha);
  return { ...state, grip };
}

/** 结束校准 → 进入游戏;上限取地板,保证安静环境也可玩 */
export function finishCalibration(state: EscapeState): EscapeState {
  return {
    ...state,
    calibratedMax: Math.max(state.calibratedMax, ESCAPE_TUNING.minCalibratedMax),
    phase: 'playing',
  };
}

/**
 * 推进一帧(dtMs 毫秒)。仅游戏期生效:
 * 速度 = 前进速度(随坚持时间 ramp)− 抓力×回拽力;位置积分并夹到 [0,1]。
 * 位置到 1 → 逃脱(整局结束)。校准/逃脱态原样返回。
 */
export function tick(state: EscapeState, dtMs: number): EscapeState {
  if (state.phase !== 'playing') return state;
  const elapsedMs = state.elapsedMs + dtMs;
  const escapeSpeed =
    ESCAPE_TUNING.baseEscapeSpeed + ESCAPE_TUNING.speedRampPerSec * (elapsedMs / 1000);
  const velocity = escapeSpeed - state.grip * ESCAPE_TUNING.gripPull;
  const position = clamp01(state.position + velocity * (dtMs / 1000));
  return {
    ...state,
    elapsedMs,
    escapeSpeed,
    position,
    phase: position >= 1 ? 'escaped' : 'playing',
  };
}
