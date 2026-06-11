import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  AppState,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  usesExclusionMode,
  type ContextSelection,
  type GroupMessage,
  type ContextUsage,
  type IntentAnalyzeResult,
  type IntentKind,
  type MemoryIntentSlots,
} from '@xzz/shared';
import type { GroupStackParamList } from '../navigation/types';
import { api } from '../lib/api';
import { navigateBrainTab } from '../lib/navigateBrain';
import { apiErrorText } from '../lib/apiError';
import { isAuthErrorMessage } from '../lib/authEvents';
import * as Clipboard from 'expo-clipboard';
import { appAlert } from '../lib/appAlert';
import { appPromptText } from '../lib/appPrompt';
import { attachChatTimeFlags } from '../lib/chatTime';
import {
  appendUniqueById,
  dedupeById,
  getCachedMessages,
  mergeMessagesById,
  setCachedMessages,
} from '../lib/chatMessageCache';
import { getChatLlmModel, setChatLlmModel } from '../lib/chatLlmModel';
import { AskAiHubSheet } from '../components/AskAiHubSheet';
import { AskAiModelPickerSheet } from '../components/AskAiModelPickerSheet';
import { ContextComposerModal } from '../components/ContextComposerModal';
import { DraggableAskAiFab } from '../components/DraggableAskAiFab';
import { ChatComposeBar } from '../components/ChatComposeBar';
import { SlashCommandsTip } from '../components/SlashCommandsTip';
import { zh } from '../locales/zh-CN';
import { ChatMessageRow, chatBubbleTextStyle } from '../components/ChatMessageRow';
import { AgentRunCard } from '../features/agent/AgentRunCard';
import { AskUserPromptCard } from '../features/agent/AskUserPromptCard';
import { useAgentModelPicker } from '../features/agent/useAgentModelPicker';
import { AgentModelPickerSheet } from '../features/agent/AgentModelPickerSheet';
import { ChatMessageContent } from '../components/chat/ChatMessageContent';
import {
  BubbleTextSelectionProvider,
  bubbleTextSelectionClearActive,
  bubbleTextSelectionTryDismissOnTouchEnd,
} from '../components/chat/BubbleTextSelectionContext';
import {
  isIntentExecuteResult,
  mergeGroupMessages,
} from '../lib/applyIntentExecute';
import { announceAssistantWaiting } from '../lib/assistantFeedback';
import { prepareChatMessageForSend } from '../lib/chatMessageInput';
import { ChatMessageActionMenu } from '../components/chat/ChatMessageActionMenu';
import { useChatListViewport } from '../hooks/useChatListViewport';
import { useMessageActionViewport } from '../hooks/useMessageActionViewport';
import type { MessageBubbleAnchor } from '../components/chat/MessageBubbleAnchor';
import { canMarkGroupMessage } from '../lib/canMarkLlmExclude';
import { openMessageAction, type MessageActionTarget } from '../lib/messageActionMenu';
import { zenmuxChatModelLabel } from '../lib/chatLlmModel';
import { WeChatChatHeader } from '../components/WeChatChatHeader';
import { IntentChipBar } from '../components/IntentChipBar';
import {
  analyzeMessage,
  executeMessageIntent,
  shouldShowIntentChips,
} from '../lib/intentFlow';
import {
  applyAppNavigate,
  isClientNavigateKind,
} from '../lib/appNavigateFromIntent';
import { useAuth } from '../components/AuthGate';
import { colors } from '../theme/colors';
import { wechatChatStyles } from '../theme/wechatChat';

type Props = NativeStackScreenProps<GroupStackParamList, 'GroupChat'>;

type GroupMessageUi = GroupMessage & {
  showTimestamp: boolean;
  timeLabel: string;
  /** 本地占位：对侧 AI 思考中 */
  uiPending?: boolean;
};

function stripLocalGroupMessages(items: GroupMessage[]): GroupMessage[] {
  return items.filter((m) => !m.id.startsWith('local-'));
}

function localInvokeHumanMessage(
  groupId: string,
  topicId: string,
  user: { id: string; displayName: string },
  text: string,
  model: string,
): GroupMessage {
  return {
    id: `local-human-${Date.now()}`,
    groupId,
    topicId,
    authorId: user.id,
    authorDisplayName: user.displayName,
    kind: 'human',
    content: text,
    contentMode: 'text',
    createdAt: new Date().toISOString(),
    llmInvoke: {
      model,
      totalTokens: 0,
      promptTokens: 0,
      completionTokens: 0,
    },
  };
}

function localPendingAiMessage(groupId: string, topicId: string): GroupMessage {
  return {
    id: `local-ai-${Date.now()}`,
    groupId,
    topicId,
    authorId: 'assistant',
    kind: 'ai',
    content: '',
    contentMode: 'text',
    createdAt: new Date().toISOString(),
  };
}

export function GroupChatScreen({ route, navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { groupId, groupName, topicId, topicName, scrollToMessageId } = route.params;
  const [displayTopicName, setDisplayTopicName] = useState(topicName);
  const { user } = useAuth();
  const [messages, setMessages] = useState<GroupMessage[]>([]);
  // 首载指示:仅在「无缓存可显」时兜底渲染 spinner(缓存命中则瞬时出内容)。
  const [initialLoading, setInitialLoading] = useState(true);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [thinkingLine] = useState(zh.chat.thinking);
  const [contextUsage, setContextUsage] = useState<ContextUsage | null>(null);
  const [chatModel, setChatModel] = useState<string>('moonshotai/kimi-k2.6');
  const {
    current: agentModel,
    missingKeys: agentMissingKeys,
    sheetVisible: agentSheetVisible,
    setSheetVisible: setAgentSheetVisible,
    pick: pickAgentModel,
  } = useAgentModelPicker();
  const [askAiMode, setAskAiMode] = useState(false);
  const [askAiHubOpen, setAskAiHubOpen] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [contextSelection, setContextSelection] = useState<ContextSelection | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastIdRef = useRef<string | null>(null);
  const listHostRef = useRef<View>(null);
  const composeRef = useRef<View>(null);
  const [messageAction, setMessageAction] = useState<MessageActionTarget<GroupMessage> | null>(
    null,
  );
  const [messageActionBusy, setMessageActionBusy] = useState(false);
  const messageCountRef = useRef(0);
  messageCountRef.current = messages.length;

  useEffect(() => {
    setDisplayTopicName(topicName);
  }, [topicName]);

  const renameTopic = useCallback(async () => {
    const title = await appPromptText(zh.studio.renameTopicTitle, '', displayTopicName);
    if (title === null) return;
    const name = title.trim();
    if (!name) {
      appAlert(zh.studio.renameTopicTitle, zh.studio.renameTopicEmpty);
      return;
    }
    try {
      const res = await api.updateTopic(groupId, topicId, name);
      setDisplayTopicName(res.data.title);
      navigation.setParams({ topicName: res.data.title });
    } catch (e) {
      appAlert(zh.studio.renameTopicFailed, apiErrorText(e).message);
    }
  }, [displayTopicName, groupId, navigation, topicId]);

  useFocusEffect(
    useCallback(() => {
      return () => {
        if (messageCountRef.current >= 4) {
          void api.topicAutoExtract(groupId, topicId).catch(() => {});
        }
      };
    }, [groupId, topicId]),
  );

  const [pendingIntent, setPendingIntent] = useState<{
    text: string;
    analyze: IntentAnalyzeResult;
  } | null>(null);

  const messagesUi = useMemo(
    () =>
      // dedupeById:渲染层最后防线,任何路径残留的重复 id 在喂给 FlatList 前收敛(重复 key 是 React 硬错误)。
      attachChatTimeFlags(dedupeById(messages)).map((m) => ({
        ...m,
        uiPending: m.id.startsWith('local-ai-'),
      })),
    [messages],
  );
  const { listRef, listOpacityStyle, highlightMessageId, scrollToEnd, viewportListProps } =
    useChatListViewport({
      resetKey: `${groupId}:${topicId}`,
      messages: messagesUi,
      scrollToMessageId,
      onScrollBeginDrag: bubbleTextSelectionClearActive,
    });
  const { viewport: messageActionViewport, composeRect: messageActionComposeRect } =
    useMessageActionViewport(listHostRef, composeRef, messageAction !== null);

  useEffect(() => {
    void getChatLlmModel().then(setChatModel);
  }, []);

  const cacheKey = `${groupId}:${topicId}`;
  const loadMessages = useCallback(
    async (opts?: { poll?: boolean }) => {
      const after = opts?.poll ? lastIdRef.current ?? undefined : undefined;
      const res = await api.listGroupMessages(groupId, topicId, after ? { after } : undefined);
      if (opts?.poll && after && res.data.length === 0) return;
      if (opts?.poll && after) {
        // 新消息 append 后，列表内容撑高 → onContentSizeChange 会按「是否粘底」
        // 决定自动跟随到底（修复「新消息来了纹丝不动」），翻历史时不打扰。
        // appendUniqueById:after 游标与已有消息重叠时服务端会回传已在列表里的条目,
        // 直接 [...prev,...res] 会让 FlatList 出现重复 key —— 只追加 prev 里没有的 id。
        setMessages((prev) => appendUniqueById(prev, res.data));
      } else {
        // W1b:全量刷新对旧列表做引用稳定 merge,未变消息不重渲染;
        // preserveLocal 保住发送中的乐观占位(否则空话题轮询/聚焦重拉会吞掉它们)。
        setMessages((prev) => mergeMessagesById(prev, res.data, { preserveLocal: true }));
      }
      const last = res.data[res.data.length - 1];
      if (last) lastIdRef.current = last.id;
    },
    [groupId, topicId],
  );

  // 本地变更/轮询追加都回写缓存;local- 占位不入缓存。
  // topicId 字段守卫:同实例换话题瞬间旧列表不写进新话题的缓存键(终审随注)。
  useEffect(() => {
    const settled = messages.filter((m) => !m.id.startsWith('local-') && m.topicId === topicId);
    if (settled.length > 0) setCachedMessages(cacheKey, settled);
  }, [messages, cacheKey, topicId]);

  // 同实例换 topic(无 getId 的参数级导航)时 lastIdRef 残留旧话题游标,
  // 会让缓存 seed 被跳过且轮询带跨话题 after 漏消息 —— 参数变更即归零。
  useEffect(() => {
    lastIdRef.current = null;
  }, [groupId, topicId]);

  // W1b + W1 顺手:进话题先渲染缓存;轮询只在屏幕聚焦时跑,且 app 退后台时跳过 tick。
  useFocusEffect(
    useCallback(() => {
      if (lastIdRef.current === null) {
        const cached = getCachedMessages<GroupMessage>(cacheKey);
        if (cached) {
          setMessages(cached);
          lastIdRef.current = cached[cached.length - 1]?.id ?? null;
        }
      }
      void loadMessages()
        .catch((e) => appAlert('消息加载失败', apiErrorText(e).message))
        .finally(() => setInitialLoading(false));
      pollRef.current = setInterval(() => {
        if (AppState.currentState !== 'active') return;
        void loadMessages({ poll: true }).catch(() => {});
      }, 4000);
      return () => {
        if (pollRef.current) clearInterval(pollRef.current);
      };
    }, [loadMessages, cacheKey]),
  );

  useEffect(() => {
    void api
      .getGroupContextUsage(groupId, topicId, input)
      .then((r) => setContextUsage(r.data))
      .catch(() => setContextUsage(null));
  }, [groupId, topicId, input]);

  async function sendHuman() {
    const text = prepareChatMessageForSend(input);
    if (!text) return;
    setInput('');
    setSending(true);
    try {
      await api.sendGroupMessage(groupId, topicId, text);
      await loadMessages();
      scrollToEnd();
    } catch (e) {
      appAlert('发送失败', apiErrorText(e).message);
    } finally {
      setSending(false);
    }
  }

  const patchGroupMessage = useCallback((updated: GroupMessage) => {
    setMessages((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
  }, []);

  const handleCopyMessage = useCallback(async () => {
    if (!messageAction?.copyText.trim()) return;
    await Clipboard.setStringAsync(messageAction.copyText);
    setMessageAction(null);
  }, [messageAction]);

  const handleMarkLlmExclude = useCallback(async () => {
    if (!messageAction) return;
    setMessageActionBusy(true);
    try {
      const res = await api.markGroupLlmExclude(groupId, topicId, messageAction.message.id);
      patchGroupMessage(res.data);
      setMessageAction(null);
    } catch (e) {
      appAlert('标记失败', apiErrorText(e).message);
    } finally {
      setMessageActionBusy(false);
    }
  }, [messageAction, groupId, topicId, patchGroupMessage]);

  const handleCancelLlmExclude = useCallback(async () => {
    if (!messageAction) return;
    setMessageActionBusy(true);
    try {
      const res = await api.cancelGroupLlmExclude(groupId, topicId, messageAction.message.id);
      patchGroupMessage(res.data);
      setMessageAction(null);
    } catch (e) {
      appAlert('取消标记失败', apiErrorText(e).message);
    } finally {
      setMessageActionBusy(false);
    }
  }, [messageAction, groupId, topicId, patchGroupMessage]);

  const bubbleMarkProps = (item: GroupMessage) => ({
    onBubbleLongPress: (anchor: MessageBubbleAnchor) =>
      openMessageAction(
        {
          message: item,
          copyText: item.content,
          anchor,
          canMark: canMarkGroupMessage(item),
        },
        setMessageAction,
      ),
    contextExcluded: item.llmExclude?.active === true,
  });

  const appendGroupLlmPending = useCallback(
    (instruction: string) => {
      if (!user) return;
      setMessages((prev) => [
        ...prev,
        localInvokeHumanMessage(groupId, topicId, user, instruction, chatModel),
        localPendingAiMessage(groupId, topicId),
      ]);
      scrollToEnd();
      void announceAssistantWaiting(thinkingLine);
    },
    [user, groupId, topicId, chatModel, scrollToEnd, thinkingLine],
  );

  const runIntentExecute = useCallback(
    async (
      text: string,
      kind: IntentKind,
      slots?: MemoryIntentSlots,
      targetFragmentId?: string,
    ): Promise<boolean> => {
      if (isClientNavigateKind(kind)) {
        setPendingIntent(null);
        const navigated = applyAppNavigate(navigation, kind, slots, {
          groupId,
          topicId,
        });
        if (navigated) setInput('');
        else appAlert('无法打开', '请稍后重试，或从「我」进入对应设置');
        return navigated;
      }

      const isGroupLlm = kind === 'chat_group_llm';
      if (isGroupLlm) {
        appendGroupLlmPending(text);
      }

      setPendingIntent(null);
      setSending(true);
      try {
        // M5B: agentModel comes from useAgentModelPicker hook state (no async needed).
        const agentOptions =
          kind === 'agent_run'
            ? { providerId: agentModel.providerId, modelId: agentModel.modelId }
            : undefined;
        const res = await executeMessageIntent({
          channel: 'group',
          aiMode: true,
          text,
          groupId,
          topicId,
          model: chatModel,
          contextSelection: contextSelection ?? undefined,
          kind,
          slots,
          targetFragmentId,
          agentOptions,
        });
        const data = res.data;
        if (data.type === 'skipped') {
          if (isGroupLlm) {
            setMessages((prev) => stripLocalGroupMessages(prev));
          }
          appAlert('无法执行', data.reason);
          return false;
        }
        if (isIntentExecuteResult(data)) {
          if (data.type === 'group') {
            setMessages((prev) =>
              mergeGroupMessages(stripLocalGroupMessages(prev), [
                data.invokeMessage,
                data.aiMessage,
              ]),
            );
            scrollToEnd();
            return true;
          }
          if (data.type === 'group_human') {
            setMessages((prev) =>
              mergeGroupMessages(stripLocalGroupMessages(prev), [data.message]),
            );
            scrollToEnd();
            return true;
          }
          if (
            (data.type === 'memory' || data.type === 'tool') &&
            data.groupMessages?.length
          ) {
            setMessages((prev) =>
              mergeGroupMessages(stripLocalGroupMessages(prev), data.groupMessages),
            );
            scrollToEnd();
            return true;
          }
          if (data.type === 'agent') {
            // agent run 的 invoker/placeholderAi 消息已在后端写入 group_messages,
            // 这里清掉本地 pending 占位并重新拉取消息列表让 AgentRunCard 接管。
            setMessages((prev) => stripLocalGroupMessages(prev));
            await loadMessages();
            scrollToEnd();
            return true;
          }
        }
        if (isGroupLlm) {
          setMessages((prev) => stripLocalGroupMessages(prev));
        }
        await loadMessages();
        return true;
      } catch (e) {
        if (isGroupLlm) {
          setMessages((prev) => stripLocalGroupMessages(prev));
        }
        const { message, hint } = apiErrorText(e);
        appAlert('操作失败', hint ? `${message}\n\n${hint}` : message);
        return false;
      } finally {
        setSending(false);
      }
    },
    [
      agentModel,
      navigation,
      groupId,
      topicId,
      chatModel,
      contextSelection,
      loadMessages,
      appendGroupLlmPending,
      scrollToEnd,
    ],
  );

  const handleRememberMessage = useCallback(async () => {
    if (!messageAction?.copyText.trim()) return;
    setMessageActionBusy(true);
    try {
      await api.createMemory({
        scope: 'topic',
        groupId,
        topicId,
        content: messageAction.copyText.trim(),
      });
      setMessageAction(null);
      appAlert(zh.intent.rememberDone, zh.me.memorySaved);
    } catch (e) {
      appAlert('失败', apiErrorText(e).message);
    } finally {
      setMessageActionBusy(false);
    }
  }, [messageAction, groupId, topicId]);

  async function invokeAi() {
    const instruction = prepareChatMessageForSend(input);
    if (!instruction) {
      appAlert('请先输入内容', '在下方输入框写好要让 AI 回复的话，再点「请 AI」');
      return;
    }
    setInput('');
    setSending(true);
    try {
      const analyze = await analyzeMessage({
        channel: 'group',
        aiMode: true,
        text: instruction,
        groupId,
        topicId,
      });
      if (shouldShowIntentChips(analyze)) {
        setPendingIntent({ text: instruction, analyze });
        return;
      }
      await runIntentExecute(instruction, analyze.suggested, analyze.slots);
    } catch (e) {
      const { message, hint } = apiErrorText(e);
      appAlert('请 AI 失败', hint ? `${message}\n\n${hint}` : message);
    } finally {
      setSending(false);
    }
  }

  function renderItem({ item }: { item: GroupMessageUi }) {
    if (item.kind === 'system') {
      return (
        <View style={styles.systemRow}>
          <Text style={styles.systemText}>{item.content}</Text>
        </View>
      );
    }
    const isAi = item.kind === 'ai';
    const isSelf = !isAi && item.authorId === user?.id;
    const highlighted = item.id === highlightMessageId;

    const row = (node: ReactNode) => (
      <View
        style={[
          styles.messageCell,
          highlighted ? styles.messageHighlight : undefined,
        ]}
      >
        {node}
      </View>
    );

    const mark = bubbleMarkProps(item);

    // M7 T10：群聊 ask_user 提示卡（payload.askUser 经 ...payload 平铺到 message）。
    const askUser = (
      item as unknown as {
        askUser?: { runId?: string; target?: string; question?: string; openedForAll?: boolean };
      }
    ).askUser;
    if (askUser?.runId) {
      return row(
        <AskUserPromptCard
          runId={askUser.runId}
          initial={{
            question: askUser.question ?? '请回答',
            target: askUser.target ?? '',
            openedForAll: !!askUser.openedForAll,
          }}
        />,
      );
    }

    // M1b-3：agent run 占位消息（私聊 / 群聊 placeholderAi 都靠这个字段）
    const agentRunId = (item as unknown as { agentRun?: { agentRunId?: string } })
      .agentRun?.agentRunId;
    if (agentRunId) {
      return row(<AgentRunCard runId={agentRunId} />);
    }

    if (isAi) {
      const pending = item.uiPending === true;
      return row(
        <ChatMessageRow
          isSelf={false}
          avatarSpacer
          avatarName=""
          avatarSeed="ai"
          showTimestamp={item.showTimestamp}
          timeLabel={item.timeLabel}
          llmReply={pending ? null : item.llmReply ?? null}
          metaModelLabel={
            pending || item.llmReply ? undefined : zenmuxChatModelLabel(chatModel)
          }
          onBubbleLongPress={pending ? undefined : mark.onBubbleLongPress}
          contextExcluded={mark.contextExcluded}
        >
          {pending ? (
            <View style={styles.pendingRow}>
              <ActivityIndicator color={colors.primary} size="small" />
              <Text style={[chatBubbleTextStyle.text, styles.pendingText]}>
                {thinkingLine}
              </Text>
            </View>
          ) : (
            <ChatMessageContent content={item.content} messageSelectionKey={item.id} />
          )}
        </ChatMessageRow>,
      );
    }

    const senderName = !isSelf ? item.authorDisplayName ?? '成员' : undefined;

    return row(
      <ChatMessageRow
        isSelf={isSelf}
        compactAskAiBadge
        avatarName={item.authorDisplayName ?? '成员'}
        avatarSeed={item.authorId}
        avatarImageUri={isSelf ? user?.avatarDisplayUrl : undefined}
        showTimestamp={item.showTimestamp}
        timeLabel={item.timeLabel}
        senderName={senderName}
        llmInvoke={isSelf ? item.llmInvoke : null}
        onBubbleLongPress={mark.onBubbleLongPress}
        contextExcluded={mark.contextExcluded}
      >
        <ChatMessageContent content={item.content} messageSelectionKey={item.id} />
      </ChatMessageRow>,
    );
  }

  return (
    <View style={[wechatChatStyles.page, styles.pageHost]}>
      <View
        onStartShouldSetResponderCapture={() => {
          bubbleTextSelectionClearActive();
          return false;
        }}
      >
        <WeChatChatHeader
          title={displayTopicName}
          showBack
          onTitlePress={() => void renameTopic()}
          onTitleLongPress={() => void renameTopic()}
        />
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        <BubbleTextSelectionProvider>
        <View ref={listHostRef} style={styles.chatBody} collapsable={false}>
          <FlatList
            ref={listRef}
            style={[styles.flex, listOpacityStyle]}
            data={messagesUi}
            keyExtractor={(m) => m.id}
            renderItem={renderItem}
            contentContainerStyle={wechatChatStyles.listContent}
            keyboardShouldPersistTaps="handled"
            onTouchEndCapture={bubbleTextSelectionTryDismissOnTouchEnd}
            removeClippedSubviews={Platform.OS !== 'android'}
            initialNumToRender={20}
            maxToRenderPerBatch={12}
            windowSize={9}
            updateCellsBatchingPeriod={50}
            {...viewportListProps}
          />
          {initialLoading && messagesUi.length === 0 ? (
            <View style={styles.initialLoadingOverlay} pointerEvents="none">
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : null}
          <DraggableAskAiFab
            active={askAiMode}
            onTap={() => setAskAiMode((v) => !v)}
            onLongPress={() => setAskAiHubOpen(true)}
          />
        </View>

        {contextSelection && usesExclusionMode(contextSelection) ? (
          <Text style={styles.contextHint}>
            {zh.chat.contextExcludedActive(contextSelection.excludedMessageIds?.length ?? 0)}
          </Text>
        ) : null}

        {pendingIntent ? (
          <IntentChipBar
            analyze={pendingIntent.analyze}
            onSelectIntent={(kind, slots) => {
              void (async () => {
                setInput('');
                await runIntentExecute(pendingIntent.text, kind, slots);
              })();
            }}
            onSelectMemoryTarget={(fragmentId, kind) => {
              void (async () => {
                setInput('');
                await runIntentExecute(
                  pendingIntent.text,
                  kind,
                  pendingIntent.analyze.slots,
                  fragmentId,
                );
              })();
            }}
            onDismiss={() => setPendingIntent(null)}
          />
        ) : null}

        <View
          onStartShouldSetResponderCapture={() => {
            bubbleTextSelectionClearActive();
            return false;
          }}
        >
          <View ref={composeRef} collapsable={false}>
            <SlashCommandsTip
              visible={messages.length === 0 && !pendingIntent && !input.trim()}
            />
            <Pressable
              onPress={() => setAgentSheetVisible(true)}
              style={styles.agentModelChip}
            >
              <Text style={styles.agentModelChipText}>模型: {agentModel.label} ▾</Text>
            </Pressable>
            <ChatComposeBar
              value={input}
              onChangeText={setInput}
              contextUsage={contextUsage}
              onSend={() => (askAiMode ? void invokeAi() : void sendHuman())}
              sendLabel={sending ? 'AI 回复中…' : zh.chat.send}
              askAiHighlight={askAiMode}
              composeIconVariant={askAiMode ? 'ai' : 'human'}
              placeholder={askAiMode ? zh.chat.askAiPlaceholder : zh.chat.placeholder}
              onSendVoiceText={(text) => {
                if (!text.trim() || isAuthErrorMessage(text)) return;
                void (async () => {
                  setSending(true);
                  try {
                    await api.sendGroupMessage(groupId, topicId, prepareChatMessageForSend(text));
                    setInput('');
                    await loadMessages();
                  } catch (e) {
                    appAlert('发送失败', apiErrorText(e).message);
                  } finally {
                    setSending(false);
                  }
                })();
              }}
              onPickImage={(asset) => {
                if (!asset.base64) return;
                void (async () => {
                  setSending(true);
                  try {
                    const mime = asset.mimeType ?? 'image/jpeg';
                    const dataUrl = `data:${mime};base64,${asset.base64}`;
                    const up = await api.uploadMedia({ mimeType: mime, dataUrl });
                    await api.sendGroupMessage(groupId, topicId, '', [up.data.id]);
                    await loadMessages();
                  } catch (e) {
                    appAlert('发送图片失败', apiErrorText(e).message);
                  } finally {
                    setSending(false);
                  }
                })();
              }}
              busy={sending}
              bottomInset={8}
              reserveContextSlot
            />
          </View>
        </View>
        </BubbleTextSelectionProvider>
      </KeyboardAvoidingView>

      <AskAiHubSheet
        visible={askAiHubOpen}
        onClose={() => setAskAiHubOpen(false)}
        onChangeModel={() => setModelPickerOpen(true)}
        onComposeContext={() => setComposerOpen(true)}
        onTopicMemory={() =>
          navigateBrainTab(navigation, 'SettingsMemory', {
            scope: 'topic',
            groupId,
            topicId,
          })
        }
      />
      <AskAiModelPickerSheet
        visible={modelPickerOpen}
        modelId={chatModel}
        onClose={() => setModelPickerOpen(false)}
        onSelectModel={(id) => {
          setChatModel(id);
          void setChatLlmModel(id);
        }}
      />
      <ContextComposerModal
        visible={composerOpen}
        source="group"
        groupId={groupId}
        topicId={topicId}
        pendingText={input}
        initialSelection={contextSelection}
        onClose={() => setComposerOpen(false)}
        onApply={(sel) => setContextSelection(sel)}
      />
      <ChatMessageActionMenu
        visible={messageAction !== null}
        anchor={messageAction?.anchor ?? null}
        viewport={messageActionViewport}
        composeRect={messageActionComposeRect}
        canCopy={Boolean(messageAction?.copyText.trim())}
        canMark={messageAction?.canMark ?? false}
        canRemember={
          messageAction?.message.kind === 'human' &&
          messageAction.message.authorId === user?.id &&
          Boolean(messageAction.copyText.trim())
        }
        markActive={messageAction?.message.llmExclude?.active === true}
        busy={messageActionBusy}
        onClose={() => {
          bubbleTextSelectionClearActive();
          setMessageAction(null);
        }}
        onCopy={() => void handleCopyMessage()}
        onMark={() => void handleMarkLlmExclude()}
        onCancelMark={() => void handleCancelLlmExclude()}
        onRemember={() => void handleRememberMessage()}
      />
      <AgentModelPickerSheet
        visible={agentSheetVisible}
        current={agentModel}
        missingKeys={agentMissingKeys}
        onPick={pickAgentModel}
        onClose={() => setAgentSheetVisible(false)}
        onConfigureKeys={() => {
          setAgentSheetVisible(false);
          navigateBrainTab(navigation, 'BrainHomeKeys');
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  pageHost: { position: 'relative' },
  systemRow: {
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 24,
  },
  systemText: {
    fontSize: 12,
    color: colors.textMuted,
    textAlign: 'center',
  },
  flex: { flex: 1 },
  chatBody: { flex: 1, position: 'relative', minHeight: 0 },
  initialLoadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  messageCell: {
    flexGrow: 0,
    flexShrink: 0,
    width: '100%',
  },
  messageHighlight: {
    backgroundColor: colors.messageHighlight,
  },
  contextHint: {
    fontSize: 12,
    color: colors.textMuted,
    textAlign: 'center',
    paddingVertical: 4,
    paddingHorizontal: 12,
  },
  pendingRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  pendingText: {
    flex: 1,
  },
  agentModelChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    paddingHorizontal: 8,
    backgroundColor: colors.selectedBg,
    borderRadius: 12,
    alignSelf: 'flex-start',
    marginBottom: 4,
    marginLeft: 8,
  },
  agentModelChipText: {
    fontSize: 12,
    color: colors.link,
  },
});
