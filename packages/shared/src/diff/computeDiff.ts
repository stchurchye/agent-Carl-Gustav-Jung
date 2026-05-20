import type { DiffSegment } from '../types.js';

/**
 * 简易字符级 diff，用于增删对比展示。
 * 生产环境可替换为 diff-match-patch。
 */
export function computeDiff(oldText: string, newText: string): DiffSegment[] {
  if (oldText === newText) {
    return oldText ? [{ type: 'equal', text: oldText }] : [];
  }

  const segments: DiffSegment[] = [];
  let i = 0;
  let j = 0;
  const o = [...oldText];
  const n = [...newText];

  while (i < o.length || j < n.length) {
    if (i < o.length && j < n.length && o[i] === n[j]) {
      let buf = '';
      while (i < o.length && j < n.length && o[i] === n[j]) {
        buf += o[i];
        i++;
        j++;
      }
      if (buf) segments.push({ type: 'equal', text: buf });
      continue;
    }

    if (j < n.length && (i >= o.length || o[i] !== n[j])) {
      let buf = '';
      while (j < n.length && (i >= o.length || o[i] !== n[j])) {
        buf += n[j];
        j++;
        if (i < o.length && o[i] === n[j]) break;
      }
      if (buf) segments.push({ type: 'insert', text: buf });
      continue;
    }

    if (i < o.length) {
      let buf = '';
      while (i < o.length && (j >= n.length || o[i] !== n[j])) {
        buf += o[i];
        i++;
      }
      if (buf) segments.push({ type: 'delete', text: buf });
    }
  }

  return mergeAdjacent(segments);
}

function mergeAdjacent(segments: DiffSegment[]): DiffSegment[] {
  const result: DiffSegment[] = [];
  for (const seg of segments) {
    const last = result[result.length - 1];
    if (last && last.type === seg.type) {
      last.text += seg.text;
    } else if (seg.text) {
      result.push({ ...seg });
    }
  }
  return result;
}

export function diffSummary(segments: DiffSegment[]): string {
  let inserts = 0;
  let deletes = 0;
  for (const s of segments) {
    if (s.type === 'insert') inserts += s.text.length;
    if (s.type === 'delete') deletes += s.text.length;
  }
  const parts: string[] = [];
  if (inserts > 0) parts.push(`新加了${inserts}个字`);
  if (deletes > 0) parts.push(`删去了${deletes}个字`);
  if (parts.length === 0) return '内容没有变化';
  return `帮您改了一下，${parts.join('，')}`;
}
