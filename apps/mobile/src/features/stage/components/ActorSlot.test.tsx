import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import type { CompiledCharacter, CompiledSprite } from '../../../pixel/types';
import { ActorSlot } from './ActorSlot';

const sp = (color: string): CompiledSprite => ({
  size: 4,
  layers: [{ color, runs: [{ x: 0, y: 0, w: 1 }] }],
});
const character: CompiledCharacter = {
  size: 4,
  still: sp('#1'),
  base: sp('#2'),
  eyesOpen: sp('#3'),
  eyesClosed: sp('#4'),
  mouthIdle: sp('#5'),
  mouthTalk: sp('#6'),
};
const MOTION = { blinkMinMs: 3000, blinkMaxMs: 5000, wagMs: 0, bounceRatio: 0.05 };
const actor = { id: 'dog:self', kind: 'dog' as const, name: '旺财', seed: 'assistant' };

describe('ActorSlot', () => {
  it('渲染名牌;点按触发 onPress 并飘「汪!」', () => {
    const onPress = jest.fn();
    const { getByText, getByTestId, queryByText } = render(
      <ActorSlot actor={actor} character={character} motion={MOTION} size={64} onPress={onPress} testID="slot" />,
    );
    expect(getByText('旺财')).toBeTruthy();
    expect(queryByText('汪!')).toBeNull();
    fireEvent(getByTestId('slot'), 'pressOut');
    fireEvent.press(getByTestId('slot'));
    expect(onPress).toHaveBeenCalledWith(actor);
    expect(getByText('汪!')).toBeTruthy();
  });

  it('attention 角标', () => {
    const { getByTestId } = render(
      <ActorSlot actor={actor} character={character} motion={MOTION} size={64} attention testID="slot" />,
    );
    expect(getByTestId('slot-attention')).toBeTruthy();
  });

  it('连点按 reactions 轮换(摸狗彩蛋分级)', () => {
    const { getByTestId, getByText } = render(
      <ActorSlot
        actor={actor}
        character={character}
        motion={MOTION}
        size={64}
        reactions={['汪!', '汪汪汪!', '(开心转圈)']}
        testID="slot"
      />,
    );
    fireEvent(getByTestId('slot'), 'pressOut');
    expect(getByText('汪!')).toBeTruthy();
    fireEvent(getByTestId('slot'), 'pressOut');
    expect(getByText('汪汪汪!')).toBeTruthy();
    fireEvent(getByTestId('slot'), 'pressOut');
    expect(getByText('(开心转圈)')).toBeTruthy();
  });
});
