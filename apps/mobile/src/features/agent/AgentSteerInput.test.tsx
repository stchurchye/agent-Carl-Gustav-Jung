import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { AgentSteerInput } from './AgentSteerInput';

// Review 2026-06-11 [P1][mobile-agent] AgentSteerInput.tsx:34
// 无提交守卫:setText('') 是异步的,同帧双击在重渲染前各触发一次 onSubmit
// → 同一条 steer 指令并行打两次后端。修后:ref 同步守卫 + 在途禁用。
describe('AgentSteerInput 重复提交守卫', () => {
  it('同帧双击只触发一次 onSubmit', async () => {
    let resolveSubmit: () => void = () => {};
    const onSubmit = jest.fn(
      () => new Promise<void>((r) => (resolveSubmit = r)),
    );
    const { getByText, getByPlaceholderText } = render(
      <AgentSteerInput onSubmit={onSubmit} />,
    );
    fireEvent.changeText(getByPlaceholderText('发送指令调整 agent 行为…'), '改方向');

    const btn = getByText('steer');
    await act(async () => {
      fireEvent.press(btn);
      fireEvent.press(btn); // 重渲染前的第二击
    });
    expect(onSubmit).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveSubmit();
    });
  });

  it('onSubmit 在途期间再点不触发,完成后可再次提交', async () => {
    let resolveSubmit: () => void = () => {};
    const onSubmit = jest.fn(
      () => new Promise<void>((r) => (resolveSubmit = r)),
    );
    const { getByText, getByPlaceholderText } = render(
      <AgentSteerInput onSubmit={onSubmit} />,
    );
    const input = getByPlaceholderText('发送指令调整 agent 行为…');
    fireEvent.changeText(input, '第一条');
    await act(async () => {
      fireEvent.press(getByText('steer'));
    });
    // 在途:输入新文本后再点,仍不触发
    fireEvent.changeText(input, '第二条');
    await act(async () => {
      fireEvent.press(getByText('steer'));
    });
    expect(onSubmit).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveSubmit();
    });
    fireEvent.changeText(input, '第二条');
    await act(async () => {
      fireEvent.press(getByText('steer'));
    });
    expect(onSubmit).toHaveBeenCalledTimes(2);
    await act(async () => {
      resolveSubmit();
    });
  });
});

// Review round-2:steer 失败时输入框文本应恢复,不丢用户输入
// (父组件需让 onSubmit 的 Promise 真正 reject,见 AgentRunCard catch-rethrow)
it('onSubmit 失败 → 原文恢复回输入框', async () => {
  const onSubmit = jest.fn(() => Promise.reject(new Error('steer 失败')));
  const { getByText, getByPlaceholderText } = render(<AgentSteerInput onSubmit={onSubmit} />);
  const input = getByPlaceholderText('发送指令调整 agent 行为…');
  fireEvent.changeText(input, '往东走');
  await act(async () => {
    fireEvent.press(getByText('steer'));
  });
  expect(onSubmit).toHaveBeenCalledTimes(1);
  expect(input.props.value).toBe('往东走'); // 旧版:已清空丢失

  // 失败后还能再次提交
  await act(async () => {
    fireEvent.press(getByText('steer'));
  });
  expect(onSubmit).toHaveBeenCalledTimes(2);
});
