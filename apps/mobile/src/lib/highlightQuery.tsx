import type { ReactNode } from 'react';
import { Text, type TextStyle } from 'react-native';

/** 在文本中高亮搜索词（微信绿色） */
export function renderHighlightedText(
  text: string,
  query: string,
  baseStyle: TextStyle,
  highlightStyle: TextStyle,
) {
  const q = query.trim();
  if (!q) return <Text style={baseStyle}>{text}</Text>;

  const lower = text.toLowerCase();
  const needle = q.toLowerCase();
  const nodes: ReactNode[] = [];
  let start = 0;
  let i = 0;
  let pos = lower.indexOf(needle, start);

  while (pos !== -1) {
    if (pos > start) {
      nodes.push(
        <Text key={`t-${i++}`} style={baseStyle}>
          {text.slice(start, pos)}
        </Text>,
      );
    }
    nodes.push(
      <Text key={`h-${i++}`} style={[baseStyle, highlightStyle]}>
        {text.slice(pos, pos + q.length)}
      </Text>,
    );
    start = pos + q.length;
    pos = lower.indexOf(needle, start);
  }

  if (start < text.length) {
    nodes.push(
      <Text key={`t-${i++}`} style={baseStyle}>
        {text.slice(start)}
      </Text>,
    );
  }

  return <Text style={baseStyle}>{nodes}</Text>;
}
