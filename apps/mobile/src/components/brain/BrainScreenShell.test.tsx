import { Text, StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';
import { BrainScreenShell } from './BrainScreenShell';

const hint = { howRemember: '怎么记', howUse: '怎么用' };

// 行为:大脑屏统一到微信亮色主题 —— 壳的页面背景应为浅色(非暗色 EVA 主题)。
it('renders the brain shell with a light (white) page background', () => {
  const tree = render(
    <BrainScreenShell title="测试" hint={hint}>
      <Text>child</Text>
    </BrainScreenShell>,
  );
  const root = tree.toJSON();
  const style = StyleSheet.flatten((root as { props: { style: unknown } }).props.style);
  expect((style as { backgroundColor?: string }).backgroundColor).toBe('#FFFFFF');
});
