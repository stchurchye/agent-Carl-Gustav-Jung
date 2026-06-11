import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { PixelListCell } from './PixelListCell';

describe('PixelListCell 一行一卡', () => {
  it('label/value/箭头渲染,点击回调', () => {
    const onPress = jest.fn();
    const { getByText, getByTestId } = render(
      <PixelListCell label="我的狗" value="柴柴" onPress={onPress} testID="cell" />,
    );
    expect(getByText('我的狗')).toBeTruthy();
    expect(getByText('柴柴')).toBeTruthy();
    expect(getByText('›')).toBeTruthy();
    fireEvent.press(getByTestId('cell'));
    expect(onPress).toHaveBeenCalled();
  });

  it('destructive 红字且无箭头', () => {
    const { getByText, queryByText } = render(
      <PixelListCell label="退出登录" destructive onPress={jest.fn()} />,
    );
    expect(getByText('退出登录')).toBeTruthy();
    expect(queryByText('›')).toBeNull();
  });
});
