import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';
import { IntentChipBar } from './IntentChipBar';
import type { IntentAnalyzeResult } from '@xzz/shared';

// RNTL toJSON() 节点的最小结构(避免依赖 react-test-renderer 的类型声明)。
type JsonNode = {
  props?: { style?: unknown };
  children?: Array<JsonNode | string> | null;
} | null;

// 最小可渲染的意图分析结果:单个 app_navigate 候选 → 首项即"推荐"(命中 isRecommendedCandidate)。
const analyze = {
  suggested: 'app_navigate',
  candidates: [{ kind: 'app_navigate', label: '打开设置' }],
  hint: null,
  memoryTargets: [],
} as unknown as IntentAnalyzeResult;

function flattenStyles(node: JsonNode): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  const walk = (n: JsonNode | string) => {
    if (!n || typeof n === 'string') return;
    const s = StyleSheet.flatten(n.props?.style) as Record<string, unknown> | undefined;
    if (s) out.push(s);
    (n.children ?? []).forEach(walk);
  };
  walk(node);
  return out;
}

// 行为:意图条是聊天(亮色)屏上的浮层 —— 强调色必须用品牌橙(#E07B00 / rgba(224,123,0))
// 而非退役的 EVA 亮橙(rgba(255,140,26))。任何残留旧橙 = 主题未统一。
it('uses the brand orange tint (not the retired EVA bright orange) for emphasis', () => {
  const tree = render(
    <IntentChipBar
      analyze={analyze}
      onSelectIntent={() => {}}
      onSelectMemoryTarget={() => {}}
      onDismiss={() => {}}
    />,
  ).toJSON() as JsonNode;

  const allColorValues = flattenStyles(tree)
    .flatMap((s) => Object.values(s))
    .filter((v): v is string => typeof v === 'string');

  // 退役亮橙(255,140,26)不得再出现在任何渲染样式里。
  expect(allColorValues.some((v) => v.includes('255, 140, 26'))).toBe(false);
  // 推荐行的弱底用品牌赤陶 hue(U7 起 #C15F3C;原品牌橙 224,123,0 已随换肤退役)。
  expect(allColorValues.some((v) => v.includes('193, 95, 60'))).toBe(true);
  expect(allColorValues.some((v) => v.includes('224, 123, 0'))).toBe(false);
});
