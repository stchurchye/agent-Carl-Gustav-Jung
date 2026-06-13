import { render, fireEvent } from '@testing-library/react-native';
import { BowWowWorkbenchCard, type WorkbenchTopic } from './BowWowWorkbenchCard';
import { ZENMUX_CHAT_DEFAULT_MODEL } from '../lib/chatLlmModel';

const topics: WorkbenchTopic[] = [
  { id: 's1', title: '读书笔记讨论', preview: '旺财：这本讲的是…', time: '2026-06-13T05:00:00Z' },
  { id: 's2', title: '帮我写周报', preview: '我：帮我写周报', time: '2026-06-13T04:00:00Z' },
  { id: 's3', title: 'Python 报错排查', preview: '旺财：这个 KeyError…', time: '2026-06-12T10:00:00Z' },
];

function setup(over: Partial<React.ComponentProps<typeof BowWowWorkbenchCard>> = {}) {
  const onPressTopic = jest.fn();
  const onNewChat = jest.fn();
  const onPressModel = jest.fn();
  const utils = render(
    <BowWowWorkbenchCard
      assistantName="旺财"
      avatar={null}
      seed="u1"
      modelId={ZENMUX_CHAT_DEFAULT_MODEL}
      topics={topics}
      onPressTopic={onPressTopic}
      onNewChat={onNewChat}
      onPressModel={onPressModel}
      {...over}
    />,
  );
  return { ...utils, onPressTopic, onNewChat, onPressModel };
}

describe('BowWowWorkbenchCard', () => {
  it('头部显示 bow wow 名字与对话总数', () => {
    const { getByText } = setup();
    expect(getByText('旺财')).toBeTruthy();
    expect(getByText('3 个对话')).toBeTruthy();
  });

  it('狗头像只在头部出现一次(不再每行重复)', () => {
    const { queryAllByTestId } = setup();
    expect(queryAllByTestId('bowwow-header-avatar')).toHaveLength(1);
  });

  it('每个话题渲染标题/预览/时间', () => {
    const { getByText } = setup();
    expect(getByText('读书笔记讨论')).toBeTruthy();
    expect(getByText('帮我写周报')).toBeTruthy();
    expect(getByText(/这本讲的是/)).toBeTruthy();
    expect(getByText(/KeyError/)).toBeTruthy();
  });

  it('点话题回调 onPressTopic 带 sessionId', () => {
    const { getByTestId, onPressTopic } = setup();
    fireEvent.press(getByTestId('workbench-topic-s2'));
    expect(onPressTopic).toHaveBeenCalledWith('s2');
  });

  it('点头部「+」回调 onNewChat', () => {
    const { getByTestId, onNewChat } = setup();
    fireEvent.press(getByTestId('bowwow-new-chat'));
    expect(onNewChat).toHaveBeenCalledTimes(1);
  });

  it('点模型芯片回调 onPressModel', () => {
    const { getByLabelText, onPressModel } = setup();
    fireEvent.press(getByLabelText('更换 LLM 模型'));
    expect(onPressModel).toHaveBeenCalledTimes(1);
  });

  it('无话题时显示新建 CTA,点击回调 onNewChat,计数为 0', () => {
    const { getByText, getByTestId, onNewChat } = setup({ topics: [] });
    expect(getByText('0 个对话')).toBeTruthy();
    fireEvent.press(getByTestId('bowwow-empty-newchat'));
    expect(onNewChat).toHaveBeenCalledTimes(1);
  });
});
