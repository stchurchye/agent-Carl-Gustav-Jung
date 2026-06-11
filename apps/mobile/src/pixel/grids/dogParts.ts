import type {
  DogAccessory,
  DogBody,
  DogEars,
  DogPattern,
  DogPersonality,
  DogTail,
} from '@xzz/shared';
import type { PixelGrid } from '../types';

/**
 * 像素狗部件库(24×24 字符画布)。
 * 角色字符:'.'透明 B毛色 S暗部 L亮部 I描边 N鼻/口腔深色 E眼 G眼高光 T舌 W白斑 K深斑 A配饰主 C配饰浅。
 * 头部 bbox 固定(行2-12,列5-18):耳/表情/配饰共用锚点,体型差异只画在身体。
 * 眼锚点:行6-7,左眼列9-10、右眼列13-14;嘴锚点:行11-12,列10-13;鼻:行9-10 列11-12。
 */

const E24 = '........................';

// ---------- 体型(不含眼/嘴/尾,由帧叠层补) ----------

/** 敦实:宽肩方身(柴犬/秋田系) */
const BODY_STURDY: PixelGrid = [
  E24,
  E24,
  '.......IIIIIIIIII.......',
  '......ILLLLLLLLLLI......',
  '.....ILLBBBBBBBBLLI.....',
  '.....IBBBBBBBBBBBBI.....',
  '.....IBBBBBBBBBBBBI.....',
  '.....IBBBBBBBBBBBBI.....',
  '.....IBBBBBBBBBBBBI.....',
  '.....IBBLLLNNLLLBBI.....',
  '.....IBBLLLNNLLLBBI.....',
  '.....IBBBLLLLLLBBBI.....',
  '......ISBBBBBBBBSI......',
  '.......IIBBBBBBII.......',
  '......IBBBBBBBBBBI......',
  '.....IBBBBBBBBBBBBI.....',
  '.....IBBBLBBBBLBBBI.....',
  '.....IBBBBBBBBBBBBI.....',
  '.....IBSBBBBBBBBSBI.....',
  '.....IBSBBBBBBBBSBI.....',
  '.....IBBIBBBBBBIBBI.....',
  '.....IBBIBBBBBBIBBI.....',
  '.....ILLISSSSSSILLI.....',
  '.....IIIIIIIIIIIIII.....',
];

/** 圆润:水滴形圆身(萨摩耶/比熊系) */
const BODY_ROUND: PixelGrid = [
  E24,
  E24,
  '.......IIIIIIIIII.......',
  '......ILLLLLLLLLLI......',
  '.....ILLBBBBBBBBLLI.....',
  '.....IBBBBBBBBBBBBI.....',
  '.....IBBBBBBBBBBBBI.....',
  '.....IBBBBBBBBBBBBI.....',
  '.....IBBBBBBBBBBBBI.....',
  '.....IBBLLLNNLLLBBI.....',
  '.....IBBLLLNNLLLBBI.....',
  '.....IBBBLLLLLLBBBI.....',
  '......ISBBBBBBBBSI......',
  '.......IIBBBBBBII.......',
  '......IBBBBBBBBBBI......',
  '.....IBBBBLLBBBBBBI.....',
  '....IBBBBLLLLBBBBBBI....',
  '....IBBBBLLLLBBBBBBI....',
  '....IBSBBBBBBBBBBSBI....',
  '.....IBSBBBBBBBBSBI.....',
  '.....IBBIBBBBBBIBBI.....',
  '.....IBBIBBBBBBIBBI.....',
  '.....ILLISSSSSSILLI.....',
  '.....IIIIIIIIIIIIII.....',
];

/** 修长:窄肩细腰、坐姿臀部展开(哈士奇/杜宾系);臀部到列17,尾根才接得上 */
const BODY_SLIM: PixelGrid = [
  E24,
  E24,
  '.......IIIIIIIIII.......',
  '......ILLLLLLLLLLI......',
  '.....ILLBBBBBBBBLLI.....',
  '.....IBBBBBBBBBBBBI.....',
  '.....IBBBBBBBBBBBBI.....',
  '.....IBBBBBBBBBBBBI.....',
  '.....IBBBBBBBBBBBBI.....',
  '.....IBBLLLNNLLLBBI.....',
  '.....IBBLLLNNLLLBBI.....',
  '.....IBBBLLLLLLBBBI.....',
  '......ISBBBBBBBBSI......',
  '.......IIBBBBBBII.......',
  '.......IBBBBBBBBI.......',
  '......IBBBBLLBBBBI......',
  '......IBBBBLLBBBBI......',
  '......IBBBBBBBBBBI......',
  '......IBSBBBBBBSBI......',
  '......IBSBBBBBBSBI......',
  '......IBBIBBBBIBBI......',
  '......IBBIBBBBIBBI......',
  '......ILLISSSSILLI......',
  '......IIIIIIIIIIII......',
];

/** 长身短腿(柯基/腊肠系):身体横向拉长 */
const BODY_LONG: PixelGrid = [
  E24,
  E24,
  '.......IIIIIIIIII.......',
  '......ILLLLLLLLLLI......',
  '.....ILLBBBBBBBBLLI.....',
  '.....IBBBBBBBBBBBBI.....',
  '.....IBBBBBBBBBBBBI.....',
  '.....IBBBBBBBBBBBBI.....',
  '.....IBBBBBBBBBBBBI.....',
  '.....IBBLLLNNLLLBBI.....',
  '.....IBBLLLNNLLLBBI.....',
  '.....IBBBLLLLLLBBBI.....',
  '......ISBBBBBBBBSI......',
  '.......IIBBBBBBII.......',
  '....IBBBBBBBBBBBBBBI....',
  '...IBBBBLLBBBBBBBBBBI...',
  '...IBBBBLLBBBBBBBBBBI...',
  '...IBSBBBBBBBBBBBBSBI...',
  '...IBSBBBBBBBBBBBBSBI...',
  '...IBBIBBBBBBBBBBIBBI...',
  '...IBBIBBBBBBBBBBIBBI...',
  '...ILLISSSSSSSSSSILLI...',
  '...IIIIIIIIIIIIIIIIII...',
  E24,
];

export const DOG_BODY_GRIDS: Record<DogBody, PixelGrid> = {
  sturdy: BODY_STURDY,
  round: BODY_ROUND,
  slim: BODY_SLIM,
  long: BODY_LONG,
};

// ---------- 耳朵(行0-6,锚头顶两角) ----------

const EARS_POINTY: PixelGrid = [
  '......I..........I......',
  '.....IBI........IBI.....',
  '....IBSBI......IBSBI....',
  '....IBBBI......IBBBI....',
  E24,
  E24,
  E24,
  ...Array(17).fill(E24),
];

const EARS_FLOPPY: PixelGrid = [
  E24,
  E24,
  '.....II..........II.....',
  '....IBBI........IBBI....',
  '...IBSBI........IBSBI...',
  '...IBSBI........IBSBI...',
  '...IBBI..........IBBI...',
  '....II............II....',
  ...Array(16).fill(E24),
];

const EARS_FOLD: PixelGrid = [
  E24,
  '......II........II......',
  '.....IBBI......IBBI.....',
  '.....ISBI......IBSI.....',
  '......II........II......',
  E24,
  E24,
  ...Array(17).fill(E24),
];

const EARS_LONGDROP: PixelGrid = [
  E24,
  E24,
  '....II............II....',
  '...IBBI..........IBBI...',
  '...IBSI..........ISBI...',
  '...IBSI..........ISBI...',
  '...IBSI..........ISBI...',
  '...IBBI..........IBBI...',
  '....IBI..........IBI....',
  '.....I............I.....',
  ...Array(14).fill(E24),
];

export const DOG_EAR_GRIDS: Record<DogEars, PixelGrid> = {
  pointy: EARS_POINTY,
  floppy: EARS_FLOPPY,
  fold: EARS_FOLD,
  longdrop: EARS_LONGDROP,
};

// ---------- 尾巴(右侧,idle/wag 两姿态;帧叠层互斥切换) ----------

function tail(rows: Array<[number, string, number]>): PixelGrid {
  // rows: [行号, 字符串, 起始列];同一行可多段,基于当前行拼接(不能用 E24,否则后段抹前段)
  const g = Array(24).fill(E24) as string[];
  for (const [y, s, x] of rows) {
    const row = g[y];
    g[y] = `${row.slice(0, x)}${s}${row.slice(x + s.length)}`;
  }
  return g;
}

export const DOG_TAIL_GRIDS: Record<DogTail, { idle: PixelGrid; wag: PixelGrid }> = {
  curl: {
    idle: tail([
      [12, 'III', 19],
      [13, 'IBBI', 18],
      [14, 'IBIBI', 17],
      [15, 'IBBI', 18],
      [16, 'III', 19],
    ]),
    wag: tail([
      [11, 'III', 18],
      [12, 'IBBI', 17],
      [13, 'IBIBI', 16],
      [14, 'IBBI', 17],
      [15, 'III', 18],
    ]),
  },
  straight: {
    idle: tail([
      [12, 'II', 21],
      [13, 'IBI', 20],
      [14, 'IBI', 19],
      [15, 'IBI', 18],
      [16, 'II', 18],
    ]),
    wag: tail([
      [16, 'IIII', 19],
      [17, 'IBBBI', 18],
      [18, 'IIII', 19],
    ]),
  },
  stub: {
    idle: tail([
      [15, 'II', 19],
      [16, 'IBI', 18],
      [17, 'II', 18],
    ]),
    wag: tail([
      [14, 'II', 19],
      [15, 'IBI', 18],
      [16, 'II', 18],
    ]),
  },
  fluffy: {
    idle: tail([
      [11, 'III', 19],
      [12, 'IBLBI', 18],
      [13, 'IBLLBI', 17],
      [14, 'IBLLBI', 17],
      [15, 'IBBBI', 17],
      [16, 'III', 17],
    ]),
    wag: tail([
      [10, 'III', 18],
      [11, 'IBLBI', 17],
      [12, 'IBLLBI', 16],
      [13, 'IBLLBI', 16],
      [14, 'IBBBI', 16],
      [15, 'III', 16],
    ]),
  },
};

// ---------- 花纹(只染毛色格;管线 applyPattern 保证不溢出轮廓) ----------

const PATTERN_SOLID: PixelGrid = Array(24).fill(E24);

/** 柴犬式白脸围脖:口鼻+眉点+前胸(眉点在行5,眼在行6-7,睁眼也露出) */
const PATTERN_MASK: PixelGrid = tail([
  [5, 'WW', 9],
  [5, 'WW', 13],
  [9, 'WWW.WW.WWW', 7],
  [10, 'WWW.WW.WWW', 7],
  [11, 'WWWWWWWW', 8],
  [12, 'WWWWWW', 9],
  [15, 'WWWW', 10],
  [16, 'WWWW', 10],
  [17, 'WW', 11],
]);

/** 白手套:整段白足带(只染毛色格,管线保证不出轮廓;long 腿在行19-21,其余体型行20-22) */
const PATTERN_SOCKS: PixelGrid = tail([
  [19, 'WW', 4],
  [19, 'WW', 18],
  [20, 'WWWWWWWWWWWWWWWW', 4],
  [21, 'WWWWWWWWWWWWWWWW', 4],
  [22, 'WWWWWWWWWWWWWWWW', 4],
]);

/** 单眼圈深斑 */
const PATTERN_PATCH: PixelGrid = tail([
  [5, 'KKK', 12],
  [6, 'KKKK', 12],
  [7, 'KKKK', 12],
  [8, 'KKK', 13],
]);

/** 斑点:身上散点 */
const PATTERN_SPOTS: PixelGrid = tail([
  [5, 'KK', 7],
  [15, 'KK', 7],
  [16, 'KK', 12],
  [17, 'KK', 15],
  [18, 'KK', 8],
  [19, 'K', 13],
]);

export const DOG_PATTERN_GRIDS: Record<DogPattern, PixelGrid> = {
  solid: PATTERN_SOLID,
  mask: PATTERN_MASK,
  socks: PATTERN_SOCKS,
  patch: PATTERN_PATCH,
  spots: PATTERN_SPOTS,
};

// ---------- 配饰(颈部行12-14;flower 在头侧) ----------

export const DOG_ACCESSORY_GRIDS: Record<Exclude<DogAccessory, 'none'>, PixelGrid> = {
  scarf: tail([
    [12, 'AAAAAAAAAA', 7],
    [13, 'AAAAAAAAAA', 7],
    [14, 'CAA', 9],
    [15, 'CA', 9],
    [16, 'C', 9],
  ]),
  bell: tail([
    [12, 'IIIIIIIIII', 7],
    [13, 'IAAI', 10],
    [14, 'IACI', 10],
    [15, 'II', 11],
  ]),
  bandana: tail([
    [12, 'AAAAAAAAAA', 7],
    [13, 'ACAACA', 9],
    [14, 'AAAA', 10],
    [15, 'AA', 11],
  ]),
  flower: tail([
    [1, 'AA', 16],
    [2, 'ACA', 15],
    [3, 'AA', 16],
  ]),
};

// ---------- 表情(性格决定神态;成对帧叠层) ----------

type ExpressionSet = {
  eyesOpen: PixelGrid;
  eyesClosed: PixelGrid;
  mouthIdle: PixelGrid;
  mouthTalk: PixelGrid;
};

const EYES_CLOSED: PixelGrid = tail([
  [7, 'II', 9],
  [7, 'II', 13],
]);

const MOUTH_TALK: PixelGrid = tail([
  [11, 'INNI', 10],
  [12, 'ITTI', 10],
]);

export const DOG_EXPRESSION_GRIDS: Record<DogPersonality, ExpressionSet> = {
  /** 活泼:圆睁大眼带高光,咧嘴笑 */
  playful: {
    eyesOpen: tail([
      [6, 'EG', 9],
      [6, 'EG', 13],
      [7, 'EE', 9],
      [7, 'EE', 13],
    ]),
    eyesClosed: EYES_CLOSED,
    mouthIdle: tail([
      [11, 'I', 10],
      [11, 'I', 13],
      [12, 'II', 11],
    ]),
    mouthTalk: MOUTH_TALK,
  },
  /** 沉稳:半眯眼,抿嘴 */
  calm: {
    eyesOpen: tail([
      [6, 'II', 9],
      [6, 'II', 13],
      [7, 'EE', 9],
      [7, 'EE', 13],
    ]),
    eyesClosed: EYES_CLOSED,
    mouthIdle: tail([[12, 'IIII', 10]]),
    mouthTalk: MOUTH_TALK,
  },
  /** 傲娇:斜眼瞥视(单像素眼+斜睑),嘴角一撇 */
  sassy: {
    eyesOpen: tail([
      [6, 'II', 9],
      [6, 'II', 13],
      [7, 'E', 10],
      [7, 'E', 14],
    ]),
    eyesClosed: EYES_CLOSED,
    mouthIdle: tail([
      [11, 'II', 12],
      [12, 'II', 10],
    ]),
    mouthTalk: MOUTH_TALK,
  },
  /** 黏人:弯月笑眼(^ ^) */
  sweet: {
    eyesOpen: tail([
      [6, 'II', 9],
      [7, 'I', 8],
      [7, 'I', 11],
      [6, 'II', 13],
      [7, 'I', 12],
      [7, 'I', 15],
    ]),
    eyesClosed: EYES_CLOSED,
    mouthIdle: tail([
      [11, 'I', 10],
      [11, 'I', 13],
      [12, 'II', 11],
    ]),
    mouthTalk: MOUTH_TALK,
  },
  /** 呆萌:一只大眼一只眯眼,平时就吐舌 */
  goofy: {
    eyesOpen: tail([
      [6, 'EG', 9],
      [7, 'EE', 9],
      [7, 'II', 13],
    ]),
    eyesClosed: EYES_CLOSED,
    mouthIdle: tail([
      [11, 'IIII', 10],
      [12, 'TT', 11],
    ]),
    mouthTalk: MOUTH_TALK,
  },
};
