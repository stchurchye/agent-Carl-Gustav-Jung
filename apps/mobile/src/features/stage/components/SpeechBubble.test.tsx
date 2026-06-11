import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { SpeechBubble } from './SpeechBubble';

describe('SpeechBubble 舞台对话框', () => {
  it('渲染说话人名牌与完整文本', () => {
    const { getByText } = render(
      <SpeechBubble text="今天想聊点什么?" speakerName="旺财" maxHeight={300} />,
    );
    expect(getByText('旺财')).toBeTruthy();
    expect(getByText('今天想聊点什么?')).toBeTruthy();
  });

  it('pending 显示思考点', () => {
    const { getByTestId } = render(
      <SpeechBubble text="旺财正在想…" pending maxHeight={300} testID="bubble" />,
    );
    expect(getByTestId('bubble-pending')).toBeTruthy();
  });

  it('error 语气显示「再试一次」并回调', () => {
    const onRetry = jest.fn();
    const { getByText } = render(
      <SpeechBubble text="没发出去" tone="error" onRetry={onRetry} maxHeight={300} />,
    );
    fireEvent.press(getByText('再试一次'));
    expect(onRetry).toHaveBeenCalled();
  });

  it('点气泡触发 onPress(打开历史浮层)', () => {
    const onPress = jest.fn();
    const { getByTestId } = render(
      <SpeechBubble text="hi" onPress={onPress} maxHeight={300} testID="bubble" />,
    );
    fireEvent.press(getByTestId('bubble'));
    expect(onPress).toHaveBeenCalled();
  });

  it('dimmed(previous 方)透明度降低', () => {
    const { getByTestId } = render(
      <SpeechBubble text="上一句" dimmed maxHeight={120} testID="bubble" />,
    );
    const style = StyleSheetFlatten(getByTestId('bubble').props.style);
    expect(style.opacity).toBeLessThan(1);
  });
});

function StyleSheetFlatten(style: unknown): { opacity?: number } {
  if (Array.isArray(style)) return Object.assign({}, ...style.map(StyleSheetFlatten));
  return (style ?? {}) as { opacity?: number };
}
