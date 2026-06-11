import React from 'react';
import { Text } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import type { CompiledCharacter, CompiledSprite } from '../../../pixel/types';
import type { StageActor, StageLine } from '../stageTypes';
import { StageView } from './StageView';
import { StageHistoryOverlay } from './StageHistoryOverlay';

const sp = (c: string): CompiledSprite => ({ size: 4, layers: [{ color: c, runs: [{ x: 0, y: 0, w: 1 }] }] });
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
const resolveCharacter = () => ({ character, motion: MOTION });

const actor = (id: string, name: string, kind: StageActor['kind'] = 'human'): StageActor => ({
  id,
  kind,
  name,
  seed: id,
});
const line = (id: string, actorId: string, text: string, kind: StageLine['kind'] = 'chat'): StageLine => ({
  id,
  actorId,
  text,
  kind,
  createdAt: id,
});

describe('StageView', () => {
  const actors = [actor('dog:self', '旺财', 'dog'), actor('user:u1', '老王')];

  it('当前台词大气泡 + 上一句迷你气泡 + 角色名牌', () => {
    const lines = [line('1', 'user:u1', '今天天气如何'), line('2', 'dog:self', '汪!大晴天!')];
    const { getByText, getAllByText, getByTestId } = render(
      <StageView
        actors={actors}
        lines={lines}
        resolveCharacter={resolveCharacter}
        maxBubbleHeight={300}
        onActorPress={jest.fn()}
      />,
    );
    expect(getByText('汪!大晴天!')).toBeTruthy();
    expect(getByText('今天天气如何')).toBeTruthy();
    expect(getByTestId('stage-current-bubble')).toBeTruthy();
    expect(getByTestId('stage-previous-bubble')).toBeTruthy();
    // 「老王」同时出现在上一句气泡名牌与角色名牌
    expect(getAllByText('老王').length).toBeGreaterThanOrEqual(1);
  });

  it('点角色回调;超员显示 +N', () => {
    const onActorPress = jest.fn();
    const many = [...actors, actor('user:u2', '阿明'), actor('user:u3', '小红'), actor('user:u4', '老张')];
    const { getByTestId } = render(
      <StageView
        actors={many}
        lines={[line('1', 'user:u1', 'hi')]}
        resolveCharacter={resolveCharacter}
        maxSlots={4}
        maxBubbleHeight={300}
        onActorPress={onActorPress}
      />,
    );
    fireEvent.press(getByTestId('actor-dog:self'));
    expect(onActorPress).toHaveBeenCalled();
    expect(getByTestId('stage-overflow')).toBeTruthy();
  });

  it('system 行进字幕条不进对话框', () => {
    const lines = [line('1', 'user:u1', 'hi'), line('2', 'system', '阿明加入了群聊', 'system')];
    const { getByTestId } = render(
      <StageView
        actors={actors}
        lines={lines}
        resolveCharacter={resolveCharacter}
        maxBubbleHeight={300}
        onActorPress={jest.fn()}
      />,
    );
    expect(getByTestId('stage-system-ticker').props.children).toBe('阿明加入了群聊');
    expect(getByTestId('stage-current-bubble')).toBeTruthy();
  });
});

describe('StageHistoryOverlay', () => {
  it('注入 renderItem 渲染,关闭回调', () => {
    const onClose = jest.fn();
    const { getByText, getByTestId } = render(
      <StageHistoryOverlay
        visible
        onClose={onClose}
        data={[{ id: 'a', body: '第一条' }]}
        renderItem={({ item }) => <Text>{item.body}</Text>}
        keyExtractor={(m) => m.id}
      />,
    );
    expect(getByText('第一条')).toBeTruthy();
    fireEvent.press(getByTestId('overlay-close'));
    expect(onClose).toHaveBeenCalled();
  });
});
