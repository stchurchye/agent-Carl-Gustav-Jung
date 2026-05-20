/** 写作二级页左侧类型（买菜式分类） */
export const WRITING_CHAPTER_TYPE_PRESETS = [
  '会议记录',
  '日记',
  '笔记',
  '随便写写',
  '记事本',
  '待办事项',
] as const;

export type WritingChapterTypePreset = (typeof WRITING_CHAPTER_TYPE_PRESETS)[number];

/** 段落默认类型（一级） */
export const DEFAULT_CHAPTER_TYPE: WritingChapterTypePreset = WRITING_CHAPTER_TYPE_PRESETS[0];

export type ChapterTitleParts = {
  /** 一级：类型，如 会议记录、日记 */
  type: string;
  /** 二级：序号，如 1、2 */
  index: string;
  /** 可选主题备注 */
  note: string;
};

const CN_DIGITS: Record<string, string> = {
  零: '0',
  一: '1',
  二: '2',
  三: '3',
  四: '4',
  五: '5',
  六: '6',
  七: '7',
  八: '8',
  九: '9',
  十: '10',
};

function normalizeIndex(raw: string): string {
  const t = raw.trim();
  if (/^\d+$/.test(t)) return t;
  if (t.length === 1 && CN_DIGITS[t]) return CN_DIGITS[t];
  if (t === '十') return '10';
  const m = t.match(/^十([一二三四五六七八九])$/);
  if (m) return String(10 + Number(CN_DIGITS[m[1]]));
  const m2 = t.match(/^([一二三四五六七八九])十$/);
  if (m2) return String(Number(CN_DIGITS[m2[1]]) * 10);
  const m3 = t.match(/^([一二三四五六七八九])十([一二三四五六七八九])$/);
  if (m3) return String(Number(CN_DIGITS[m3[1]]) * 10 + Number(CN_DIGITS[m3[2]]));
  return t;
}

/** 解析段落标题：一级类型 + 二级序号 + 可选主题 */
export function parseChapterTitle(title: string): ChapterTitleParts {
  const trimmed = title.trim();
  if (!trimmed) {
    return { type: DEFAULT_CHAPTER_TYPE, index: '1', note: '' };
  }

  const dotted = trimmed.match(/^([^·]+)·(\d+)(?:·(.*))?$/);
  if (dotted) {
    return {
      type: dotted[1].trim() || DEFAULT_CHAPTER_TYPE,
      index: dotted[2],
      note: (dotted[3] ?? '').trim(),
    };
  }

  const legacy = trimmed.match(/^第([一二三四五六七八九十百千万\d]+)(章|节|篇|部|卷|段)(.*)$/);
  if (legacy) {
    return {
      type: legacy[2],
      index: normalizeIndex(legacy[1]),
      note: (legacy[3] ?? '').trim(),
    };
  }

  const numbered = trimmed.match(/^(\d+)(?:[·\s、：:—-]*(.*))?$/);
  if (numbered) {
    return {
      type: DEFAULT_CHAPTER_TYPE,
      index: numbered[1],
      note: (numbered[2] ?? '').trim(),
    };
  }

  return { type: DEFAULT_CHAPTER_TYPE, index: '1', note: trimmed };
}

export function buildChapterTitle(parts: ChapterTitleParts): string {
  const type = parts.type.trim() || DEFAULT_CHAPTER_TYPE;
  const index = parts.index.trim() || '1';
  const note = parts.note.trim();
  if (!note) return `${type}·${index}`;
  return `${type}·${index}·${note}`;
}

/** 列表/标签展示：「段 1」或「段 1 童年」 */
export function displayChapterTitle(title: string): string {
  const { type, index, note } = parseChapterTitle(title);
  const base = `${type} ${index}`;
  return note ? `${base} ${note}` : base;
}
