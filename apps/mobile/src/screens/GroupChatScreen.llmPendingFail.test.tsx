/**
 * Review 2026-06-11 [P1][mobile-chat] GroupChatScreen.tsx:507
 * chat_group_llm 失败路径:本地乐观占位(local-human/local-ai)在 catch 里被
 * stripLocalGroupMessages 清掉,且 input 已提前清空 → 用户输入凭空消失。
 * 修后:失败时清占位的同时把原文恢复回输入框,不丢内容。
 */
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Pressable, Text, View } from 'react-native';

const mockAppAlert = jest.fn();
const mockExecuteIntent = jest.fn();
const mockAnalyze = jest.fn();
const mockListGroupMessages = jest.fn();

jest.mock('@react-navigation/native', () => {
  const React = jest.requireActual('react');
  return {
    useFocusEffect: (cb: () => void) => React.useEffect(cb, [cb]),
    useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
  };
});
jest.mock('../lib/api', () => ({
  api: {
    listGroupMessages: (...a: unknown[]) => mockListGroupMessages(...a),
    listGroupMembers: jest.fn().mockResolvedValue({ data: [] }),
    sendGroupMessage: jest.fn(),
    updateTopic: jest.fn(),
    createMemory: jest.fn(),
    getGroupContextUsage: jest.fn().mockResolvedValue({ data: null }),
    topicAutoExtract: jest.fn().mockResolvedValue({ data: null }),
    markGroupLlmExclude: jest.fn(),
    cancelGroupLlmExclude: jest.fn(),
    uploadMedia: jest.fn(),
  },
}));
jest.mock('../lib/intentFlow', () => ({
  analyzeMessage: (...a: unknown[]) => mockAnalyze(...a),
  executeMessageIntent: (...a: unknown[]) => mockExecuteIntent(...a),
  shouldShowIntentChips: () => false,
}));
jest.mock('../lib/appAlert', () => ({ appAlert: (...a: unknown[]) => mockAppAlert(...a) }));
jest.mock('../lib/assistantFeedback', () => ({ announceAssistantWaiting: jest.fn() }));
jest.mock('../lib/chatLlmModel', () => ({
  getChatLlmModel: jest.fn().mockResolvedValue('deepseek-chat'),
  setChatLlmModel: jest.fn(),
  zenmuxChatModelLabel: () => 'model',
}));
jest.mock('../components/AuthGate', () => ({
  useAuth: () => ({ user: { id: 'u1', displayName: '我' } }),
}));
jest.mock('../features/agent/useAgentModelPicker', () => ({
  useAgentModelPicker: () => ({
    current: { providerId: 'deepseek', modelId: 'deepseek-chat', label: 'DS' },
    missingKeys: { deepseek: false, zenmux: false },
    sheetVisible: false,
    setSheetVisible: jest.fn(),
    pick: jest.fn(),
  }),
}));
// 重 UI 子组件统一打薄
jest.mock('../features/stage/components/StageView', () => ({ StageView: () => null }));
jest.mock('../features/stage/components/StageHistoryOverlay', () => {
  const { Text } = jest.requireActual('react-native');
  return {
    StageHistoryOverlay: ({ data }: { data: Array<{ id: string; content: string }> }) => (
      <>
        {data.map((m) => (
          <Text key={m.id} testID={`msg-${m.id}`}>
            {m.content}
          </Text>
        ))}
      </>
    ),
  };
});
jest.mock('../features/stage/stageCharacters', () => ({ resolveStageCharacter: () => null }));
jest.mock('../features/stage/adapters/groupStageAdapter', () => ({
  buildGroupStage: () => ({ actors: [], lines: [] }),
}));
jest.mock('../components/WeChatChatHeader', () => ({ WeChatChatHeader: () => null }));
jest.mock('../components/AskAiHubSheet', () => ({ AskAiHubSheet: () => null }));
jest.mock('../components/AskAiModelPickerSheet', () => ({ AskAiModelPickerSheet: () => null }));
jest.mock('../components/ContextComposerModal', () => ({ ContextComposerModal: () => null }));
jest.mock('../components/SlashCommandsTip', () => ({ SlashCommandsTip: () => null }));
jest.mock('../components/IntentChipBar', () => ({ IntentChipBar: () => null }));
jest.mock('../features/agent/AgentRunCard', () => ({ AgentRunCard: () => null }));
jest.mock('../features/agent/AskUserPromptCard', () => ({ AskUserPromptCard: () => null }));
jest.mock('../features/agent/AgentModelPickerSheet', () => ({
  AgentModelPickerSheet: () => null,
}));
jest.mock('../components/chat/ChatMessageActionMenu', () => ({
  ChatMessageActionMenu: () => null,
}));
jest.mock('../components/ChatMessageRow', () => {
  const { Text } = jest.requireActual('react-native');
  return {
    chatBubbleTextStyle: {},
    ChatMessageRow: ({ message }: { message: { id: string; content: string } }) => (
      <Text testID={`msg-${message.id}`}>{message.content}</Text>
    ),
  };
});
jest.mock('../components/DraggableAskAiFab', () => {
  const { Pressable, Text } = jest.requireActual('react-native');
  return {
    DraggableAskAiFab: ({ onTap }: { onTap: () => void }) => (
      <Pressable testID="fab" onPress={onTap}>
        <Text>fab</Text>
      </Pressable>
    ),
  };
});
jest.mock('../components/ChatComposeBar', () => {
  const { Pressable, Text } = jest.requireActual('react-native');
  return {
    ChatComposeBar: (props: {
      value: string;
      onChangeText: (t: string) => void;
      onSend: () => void;
    }) => (
      <>
        <Text testID="compose-value">{props.value}</Text>
        <Pressable testID="type" onPress={() => props.onChangeText('帮我想个标题')}>
          <Text>type</Text>
        </Pressable>
        <Pressable testID="send" onPress={props.onSend}>
          <Text>send</Text>
        </Pressable>
      </>
    ),
  };
});

import { GroupChatScreen } from './GroupChatScreen';

function mount() {
  const navigation = {
    navigate: jest.fn(),
    goBack: jest.fn(),
    setOptions: jest.fn(),
  } as never;
  const route = {
    key: 'k',
    name: 'GroupChat',
    params: { groupId: 'g1', groupName: '群', topicId: 't1', topicName: '话题' },
  } as never;
  return render(<GroupChatScreen navigation={navigation} route={route} />);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockListGroupMessages.mockResolvedValue({ data: [] });
  mockAnalyze.mockResolvedValue({ suggested: 'chat_group_llm', slots: {} });
});

it('chat_group_llm 执行失败 → 清掉本地占位,但把原文恢复回输入框(不丢用户输入)', async () => {
  let rejectExec: (e: unknown) => void = () => {};
  mockExecuteIntent.mockImplementation(
    () => new Promise((_r, rej) => (rejectExec = rej)),
  );

  const screen = mount();
  await waitFor(() => expect(mockListGroupMessages).toHaveBeenCalled());

  fireEvent.press(screen.getByTestId('fab')); // askAiMode on
  fireEvent.press(screen.getByTestId('type'));
  await act(async () => {
    fireEvent.press(screen.getByTestId('send'));
  });
  await waitFor(() => expect(mockExecuteIntent).toHaveBeenCalled());

  // 在途:本地乐观占位已上屏(local-human 内容=原文)
  expect(screen.getByText('帮我想个标题')).toBeTruthy();

  await act(async () => {
    rejectExec(new Error('network down'));
  });

  // 占位被清掉
  await waitFor(() =>
    expect(screen.queryAllByText('帮我想个标题').length).toBeLessThanOrEqual(1),
  );
  expect(mockAppAlert).toHaveBeenCalled();
  // 关键:原文恢复回输入框(旧版:input 已清 + 占位被 strip → 内容凭空消失)
  expect(screen.getByTestId('compose-value').props.children).toBe('帮我想个标题');
});

void View;
void Text;
void Pressable;
