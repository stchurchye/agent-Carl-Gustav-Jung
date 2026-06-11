import { Text, StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';
import { BrainScreenShell } from './BrainScreenShell';

const hint = { howRemember: '怎么记', howUse: '怎么用' };

// W2 防闪:首载 loading 显 spinner;一旦有过内容,后续 loading=true 的静默刷新
// 不再卸载 children(此前 useFocusEffect 每次聚焦 refresh 都把整屏换成 spinner)。

function shell(loading: boolean) {
  return (
    <BrainScreenShell title="标题" hint={hint} loading={loading}>
      <Text>真实内容</Text>
    </BrainScreenShell>
  );
}

it('first load shows the loader without children', () => {
  const { queryByText } = render(shell(true));
  expect(queryByText('真实内容')).toBeNull();
});

it('keeps children mounted during a refresh after content has shown once', () => {
  const r = render(shell(true));
  r.rerender(shell(false));
  expect(r.getByText('真实内容')).toBeTruthy();
  r.rerender(shell(true)); // 聚焦重拉:静默刷新,不再整屏 spinner
  expect(r.getByText('真实内容')).toBeTruthy();
});

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
