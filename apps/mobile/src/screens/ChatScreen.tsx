import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewToken,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { appAlert } from '../lib/appAlert';
import { appPromptText } from '../lib/appPrompt';
import type { GroupStackParamList } from '../navigation/types';
import {
  personaAssistantDisplayName,
  type ChatSession,
  type ContextSelection,
  type ContextUsage,
  type IntentAnalyzeResult,
  type IntentKind,
  type MemoryIntentSlots,
} from '@xzz/shared';
import { IntentChipBar } from '../components/IntentChipBar';
import {
  applyAppNavigate,
  isClientNavigateKind,
} from '../lib/appNavigateFromIntent';
import {
  analyzeMessage,
  executeMessageIntent,
  shouldShowIntentChips,
} from '../lib/intentFlow';
import {
  applyPrivateIntentResult,
  isIntentExecuteResult,
} from '../lib/applyIntentExecute';
import { api } from '../lib/api';
import { navigateBrainTab } from '../lib/navigateBrain';
import { apiErrorText } from '../lib/apiError';
import { isAuthErrorMessage } from '../lib/authEvents';
import {
  announceAssistantReplyParallel,
  announceAssistantWaiting,
  cancelAssistantFeedback,
} from '../lib/assistantFeedback';
import { isSpeaking, speakChinese, speakText, stopSpeaking } from '../lib/tts';
import { animateTypewriter } from '../lib/typewriter';
import { chatBubbleText, collectAssistantRepliesFromScreen, type ChatUiMessage } from '../lib/uiMessage';
import { zenmuxChatModelLabel } from '../lib/chatLlmModel';
import { attachChatTimeFlags } from '../lib/chatTime';
import { ChatComposeBar } from '../components/ChatComposeBar';
import { SlashCommandsTip } from '../components/SlashCommandsTip';
import { ChatMessageRow, chatBubbleTextStyle } from '../components/ChatMessageRow';
import { ChatMessageContent } from '../components/chat/ChatMessageContent';
import {
  BubbleTextSelectionProvider,
  bubbleTextSelectionClearActive,
  bubbleTextSelectionTryDismissOnTouchEnd,
} from '../components/chat/BubbleTextSelectionContext';
import { prepareChatMessageForSend } from '../lib/chatMessageInput';
import { ChatMessageActionMenu } from '../components/chat/ChatMessageActionMenu';
import { useChatListViewport } from '../hooks/useChatListViewport';
import { useMessageActionViewport } from '../hooks/useMessageActionViewport';
import type { MessageBubbleAnchor } from '../components/chat/MessageBubbleAnchor';
import { canMarkChatMessage } from '../lib/canMarkLlmExclude';
import { openMessageAction, type MessageActionTarget } from '../lib/messageActionMenu';
import { WeChatChatHeader } from '../components/WeChatChatHeader';
import { ChatUiIcon } from '../components/ChatUiIcon';
import { chatIcons } from '../assets/chatIcons';
import { useAuth } from '../components/AuthGate';
import { getChatLlmModel, setChatLlmModel } from '../lib/chatLlmModel';
import { AskAiHubSheet } from '../components/AskAiHubSheet';
import { AskAiModelPickerSheet } from '../components/AskAiModelPickerSheet';
import { ContextComposerModal } from '../components/ContextComposerModal';
import { DraggableAskAiFab } from '../components/DraggableAskAiFab';
import { ChatToolsPanel } from '../components/ChatToolsPanel';
import { WritingAssistantSheet } from '../components/WritingAssistantSheet';
import { colors, typography } from '../theme/colors';
import { useLayout } from '../theme/layout';
import { wechatChatStyles } from '../theme/wechatChat';
import { useTextStyles } from '../theme/useTextStyles';
import { zh } from '../locales/zh-CN';

function localChatMessage(
  sessionId: string,
  role: ChatUiMessage['role'],
  content: string,
  extra?: Partial<ChatUiMessage>,
): ChatUiMessage {
  return {
    id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    sessionId,
    role,
    content,
    createdAt: new Date().toISOString(),
    status: 'done',
    ...extra,
  };
}

type ChatUiMessageRow = ChatUiMessage & { showTimestamp: boolean; timeLabel: string };

const DEFAULT_SESSION_TITLE = '和小助手聊聊';

function chatSessionHeaderTitle(session: ChatSession | null): string {
  const title = session?.title?.trim();
  if (title && title !== DEFAULT_SESSION_TITLE) return title;
  return zh.chat.title;
}

type Props = NativeStackScreenProps<GroupStackParamList, 'PrivateChat'>;

export function ChatScreen({ route, navigation }: Props) {
  const initialSessionId = route.params?.sessionId;
  const scrollToMessageId = route.params?.scrollToMessageId;
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { isTablet } = useLayout();
  const textStyles = useTextStyles();
  const [assistantName, setAssistantName] = useState('小助手');
  const [session, setSession] = useState<ChatSession | null>(null);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [messages, setMessages] = useState<ChatUiMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [thinkingLine, setThinkingLine] = useState<string>(zh.chat.thinking);
  const [thinkingLongLine, setThinkingLongLine] = useState<string>(zh.chat.thinkingLong);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [contextUsage, setContextUsage] = useState<ContextUsage | null>(null);
  const [contextUsageLoading, setContextUsageLoading] = useState(false);
  const [chatModel, setChatModel] = useState<string>('moonshotai/kimi-k2.6');
  const [askAiHubOpen, setAskAiHubOpen] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [contextSelection, setContextSelection] = useState<ContextSelection | null>(null);
  const listHostRef = useRef<View>(null);
  const composeRef = useRef<View>(null);
  const pendingScrollMessageIdRef = useRef<string | undefined>(scrollToMessageId);
  const [highlightMessageId, setHighlightMessageId] = useState<string | null>(
    scrollToMessageId ?? null,
  );
  const [messageAction, setMessageAction] = useState<MessageActionTarget<ChatUiMessage> | null>(
    null,
  );
  const [messageActionBusy, setMessageActionBusy] = useState(false);
  const [pendingIntent, setPendingIntent] = useState<{
    text: string;
    analyze: IntentAnalyzeResult;
  } | null>(null);
  const typewriterAbortRef = useRef<AbortController | null>(null);
  const visibleIndicesRef = useRef<number[]>([]);
  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 15,
    minimumViewTime: 0,
  }).current;
  const messagesUi = useMemo(() => attachChatTimeFlags(messages), [messages]);
  const {
    listRef,
    listOpacityStyle,
    onContentSizeChange: onListContentSizeChange,
    scrollToEnd,
    revealList,
  } = useChatListViewport({
    resetKey: session?.id,
    messageCount: messagesUi.length,
  });
  const { viewport: messageActionViewport, composeRect: messageActionComposeRect } =
    useMessageActionViewport(listHostRef, composeRef, messageAction !== null);

  useEffect(() => {
    void api.getPersona().then((r) => {
      setAssistantName(personaAssistantDisplayName(r.data));
    }).catch(() => {});
  }, []);

  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      visibleIndicesRef.current = viewableItems
        .filter((v) => v.isViewable && v.index != null)
        .map((v) => v.index as number);
    },
  ).current;

  const refreshSessions = useCallback(async () => {
    const res = await api.listChatSessions();
    setSessions(res.data);
    return res.data;
  }, []);

  const renameSession = useCallback(
    async (target?: ChatSession) => {
      const s = target ?? session;
      if (!s) return;
      const current =
        s.title?.trim() && s.title.trim() !== DEFAULT_SESSION_TITLE
          ? s.title.trim()
          : DEFAULT_SESSION_TITLE;
      const title = await appPromptText(zh.chat.renameSessionTitle, '', current);
      if (title === null) return;
      const name = title.trim();
      if (!name) {
        appAlert(zh.chat.renameSessionTitle, zh.studio.renameTopicEmpty);
        return;
      }
      try {
        const res = await api.updateChatSession(s.id, name);
        if (s.id === session?.id) setSession(res.data);
        const list = await refreshSessions();
        const updated = list.find((x) => x.id === s.id);
        if (updated && s.id === session?.id) setSession(updated);
      } catch (e) {
        appAlert(zh.chat.renameSessionFailed, apiErrorText(e).message);
      }
    },
    [session, refreshSessions],
  );

  const refreshContextUsage = useCallback(
    async (pending?: string) => {
      const sessionId = session?.id;
      if (!sessionId) {
        setContextUsage(null);
        return;
      }
      setContextUsageLoading(true);
      try {
        const res = await api.getChatContextUsage(sessionId, pending);
        setContextUsage(res.data);
      } catch {
        setContextUsage(null);
      } finally {
        setContextUsageLoading(false);
      }
    },
    [session?.id],
  );

  const ensureSession = useCallback(async () => {
    const list = await refreshSessions();
    if (list.length > 0) {
      setSession(list[0]);
      return list[0].id;
    }
    const created = await api.createChatSession();
    setSession(created.data);
    await refreshSessions();
    return created.data.id;
  }, [refreshSessions]);

  const loadMessages = useCallback(
    async (sessionId: string) => {
      const res = await api.getChatMessages(sessionId);
      setMessages(res.data.map((m) => ({ ...m, status: 'done' as const })));
    },
    [],
  );

  useEffect(() => {
    const targetId = pendingScrollMessageIdRef.current;
    if (!targetId || messagesUi.length === 0) return;
    const idx = messagesUi.findIndex((m) => m.id === targetId);
    if (idx < 0) return;
    pendingScrollMessageIdRef.current = undefined;
    setHighlightMessageId(targetId);
    const t = setTimeout(() => {
      listRef.current?.scrollToIndex({ index: idx, animated: false, viewPosition: 0.45 });
      revealList();
    }, 16);
    const clear = setTimeout(() => setHighlightMessageId(null), 2500);
    return () => {
      clearTimeout(t);
      clearTimeout(clear);
    };
  }, [messagesUi, revealList, listRef]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (initialSessionId) {
        const list = await refreshSessions();
        const found = list.find((s) => s.id === initialSessionId);
        if (cancelled) return;
        if (found) {
          setSession(found);
          await loadMessages(found.id);
          return;
        }
      }
      const id = await ensureSession();
      if (cancelled) return;
      await loadMessages(id);
    })();
    return () => {
      cancelled = true;
    };
  }, [initialSessionId, ensureSession, loadMessages, refreshSessions]);

  const sessionIdRef = useRef<string | null>(null);
  const messageCountRef = useRef(0);
  sessionIdRef.current = session?.id ?? null;
  messageCountRef.current = messages.length;

  useFocusEffect(
    useCallback(() => {
      return () => {
        const sid = sessionIdRef.current;
        if (sid && messageCountRef.current >= 4) {
          void api.sessionAutoExtract(sid).catch(() => {});
        }
      };
    }, []),
  );

  useEffect(() => {
    void getChatLlmModel().then(setChatModel);
  }, []);

  useEffect(() => {
    void refreshContextUsage();
  }, [session?.id, refreshContextUsage]);

  useEffect(() => {
    const sessionId = session?.id;
    if (!sessionId) return;
    const timer = setTimeout(() => {
      void refreshContextUsage(input);
    }, 300);
    return () => clearTimeout(timer);
  }, [session?.id, input, refreshContextUsage]);

  useEffect(() => {
    if (!toolsOpen) return;
    void refreshSessions();
  }, [toolsOpen, refreshSessions]);

  useEffect(() => {
    return () => {
      typewriterAbortRef.current?.abort();
      void cancelAssistantFeedback();
      void stopSpeaking();
    };
  }, []);

  useEffect(() => {
    if (!sending) return;
    const timer = setTimeout(() => {
      setMessages((prev) =>
        prev.map((m) =>
          m.status === 'pending' ? { ...m, displayContent: thinkingLongLine } : m,
        ),
      );
    }, 28_000);
    return () => clearTimeout(timer);
  }, [sending, thinkingLongLine]);

  const revealAssistant = useCallback(
    async (assistantId: string, fullText: string) => {
      typewriterAbortRef.current?.abort();
      const ac = new AbortController();
      typewriterAbortRef.current = ac;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, status: 'streaming', content: fullText, displayContent: '' }
            : m,
        ),
      );
      await animateTypewriter(
        fullText,
        (visible) => {
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, displayContent: visible } : m)),
          );
          scrollToEnd();
        },
        { signal: ac.signal },
      );
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId ? { ...m, status: 'done', displayContent: undefined } : m,
        ),
      );
    },
    [scrollToEnd],
  );

  const runIntentExecute = useCallback(
    async (
      sessionId: string,
      text: string,
      kind: IntentKind,
      slots?: MemoryIntentSlots,
      targetFragmentId?: string,
    ): Promise<boolean> => {
      if (isClientNavigateKind(kind)) {
        setPendingIntent(null);
        const navigated = applyAppNavigate(navigation, kind, slots, { sessionId });
        if (navigated) setInput('');
        else appAlert('无法打开', '请稍后重试，或从「我」进入对应设置');
        return navigated;
      }
      const assistantId = `local-asst-${Date.now()}`;
      const isChat = kind === 'chat_private_llm';
      if (isChat) {
        setMessages((prev) => [
          ...prev,
          localChatMessage(sessionId, 'assistant', '', {
            id: assistantId,
            status: 'pending',
            displayContent: thinkingLine,
            retryText: text,
          }),
        ]);
        scrollToEnd();
        void announceAssistantWaiting(thinkingLine);
      }
      setPendingIntent(null);
      try {
        const res = await executeMessageIntent({
          channel: 'private',
          aiMode: true,
          text,
          sessionId,
          model: chatModel,
          contextSelection: contextSelection ?? undefined,
          kind,
          slots,
          targetFragmentId,
        });
        if (!isIntentExecuteResult(res.data)) {
          throw new Error('Invalid execute response');
        }
        const ok = await applyPrivateIntentResult(res.data, {
          onChat: async (userMsg, assistantMsg) => {
            const fullText = assistantMsg.content;
            announceAssistantReplyParallel(fullText);
            setMessages((prev) => {
              const rest = prev.filter((m) => m.id !== assistantId);
              return [
                ...rest,
                { ...userMsg, status: 'done' as const },
                {
                  ...assistantMsg,
                  id: assistantId,
                  status: 'streaming' as const,
                  content: fullText,
                  displayContent: '',
                },
              ];
            });
            await revealAssistant(assistantId, fullText);
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...assistantMsg, status: 'done' as const, displayContent: undefined }
                  : m,
              ),
            );
          },
          onMemory: (userMsg, assistantMsg) => {
            setMessages((prev) => [
              ...prev.filter((m) => m.id !== assistantId),
              { ...userMsg, status: 'done' as const },
              { ...assistantMsg, status: 'done' as const },
            ]);
          },
          onTool: (userMsg, assistantMsg) => {
            setMessages((prev) => [
              ...prev.filter((m) => m.id !== assistantId),
              { ...userMsg, status: 'done' as const },
              { ...assistantMsg, status: 'done' as const },
            ]);
          },
        });
        if (!ok && res.data.type === 'skipped') {
          appAlert('无法执行', res.data.reason);
        }
        void refreshSessions();
        scrollToEnd();
        return ok;
      } catch (e) {
        const { message, hint } = apiErrorText(e);
        if (isChat) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    status: 'error',
                    content: hint ? `${message}\n\n${hint}` : message,
                    displayContent: undefined,
                    retryText: text,
                  }
                : m,
            ),
          );
        } else {
          appAlert('操作失败', hint ? `${message}\n\n${hint}` : message);
        }
        scrollToEnd();
      }
      return false;
    },
    [
      announceAssistantReplyParallel,
      announceAssistantWaiting,
      chatModel,
      contextSelection,
      navigation,
      refreshSessions,
      revealAssistant,
      scrollToEnd,
      thinkingLine,
    ],
  );

  const sendText = useCallback(
    async (text: string) => {
      const trimmed = prepareChatMessageForSend(text);
      if (!trimmed || sending || isAuthErrorMessage(trimmed)) return;

      const sessionId = session?.id ?? (await ensureSession());
      setSending(true);
      try {
        const analyze = await analyzeMessage({
          channel: 'private',
          aiMode: true,
          text: trimmed,
          sessionId,
        });
        if (shouldShowIntentChips(analyze)) {
          setPendingIntent({ text: trimmed, analyze });
          return;
        }
        const ok = await runIntentExecute(
          sessionId,
          trimmed,
          analyze.suggested,
          analyze.slots,
        );
        if (ok) setInput('');
      } catch (e) {
        const { message, hint } = apiErrorText(e);
        appAlert('发送失败', hint ? `${message}\n\n${hint}` : message);
      } finally {
        setSending(false);
      }
    },
    [session?.id, ensureSession, sending, runIntentExecute],
  );

  const handleRememberMessage = useCallback(async () => {
    if (!messageAction?.copyText.trim() || !session?.id) return;
    setMessageActionBusy(true);
    try {
      await api.createMemory({
        scope: 'session',
        sessionId: session.id,
        content: messageAction.copyText.trim(),
      });
      setMessageAction(null);
      appAlert(zh.intent.rememberDone, zh.me.memorySaved);
    } catch (e) {
      appAlert('失败', apiErrorText(e).message);
    } finally {
      setMessageActionBusy(false);
    }
  }, [messageAction, session?.id]);

  const switchSession = useCallback(
    async (sessionId: string) => {
      if (sending || session?.id === sessionId) return;
      const leavingId = session?.id;
      if (leavingId && messages.length >= 4) {
        void api.sessionAutoExtract(leavingId).catch(() => {});
      }
      typewriterAbortRef.current?.abort();
      void cancelAssistantFeedback();
      void stopSpeaking();
      setSpeaking(false);
      const target = sessions.find((s) => s.id === sessionId);
      if (target) setSession(target);
      else {
        const list = await refreshSessions();
        const found = list.find((s) => s.id === sessionId);
        if (found) setSession(found);
      }
      await loadMessages(sessionId);
      void refreshContextUsage();
    },
    [
      sending,
      session?.id,
      sessions,
      messages.length,
      loadMessages,
      refreshSessions,
      refreshContextUsage,
    ],
  );

  const newSession = async () => {
    if (sending) return;
    const created = await api.createChatSession();
    setSession(created.data);
    setMessages([]);
    setInput('');
    setContextUsage(null);
    await refreshSessions();
  };

  const patchChatMessage = useCallback((updated: ChatUiMessage) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === updated.id ? { ...updated, status: m.status ?? 'done' } : m,
      ),
    );
  }, []);

  const handleCopyMessage = useCallback(async () => {
    if (!messageAction?.copyText.trim()) return;
    await Clipboard.setStringAsync(messageAction.copyText);
    setMessageAction(null);
  }, [messageAction]);

  const handleMarkLlmExclude = useCallback(async () => {
    if (!messageAction || !session?.id) return;
    setMessageActionBusy(true);
    try {
      const res = await api.markChatLlmExclude(session.id, messageAction.message.id);
      patchChatMessage({ ...res.data, status: 'done' });
      setMessageAction(null);
    } catch (e) {
      appAlert('标记失败', apiErrorText(e).message);
    } finally {
      setMessageActionBusy(false);
    }
  }, [messageAction, patchChatMessage, session?.id]);

  const handleCancelLlmExclude = useCallback(async () => {
    if (!messageAction || !session?.id) return;
    setMessageActionBusy(true);
    try {
      const res = await api.cancelChatLlmExclude(session.id, messageAction.message.id);
      patchChatMessage({ ...res.data, status: 'done' });
      setMessageAction(null);
    } catch (e) {
      appAlert('取消标记失败', apiErrorText(e).message);
    } finally {
      setMessageActionBusy(false);
    }
  }, [messageAction, patchChatMessage, session?.id]);

  const openBubbleAction = useCallback(
    (item: ChatUiMessageRow, anchor: MessageBubbleAnchor) => {
      openMessageAction(
        {
          message: item,
          copyText: chatBubbleText(item),
          anchor,
          canMark: canMarkChatMessage(item),
        },
        setMessageAction,
      );
    },
    [],
  );

  const readLastAssistant = () => {
    const last = [...messages].reverse().find((m) => m.role === 'assistant' && m.status === 'done');
    if (last) void speakChinese(chatBubbleText(last));
  };

  const toggleReadAloud = async () => {
    if (await isSpeaking()) {
      await stopSpeaking();
      setSpeaking(false);
      return;
    }

    const text = collectAssistantRepliesFromScreen(messages, visibleIndicesRef.current);
    if (!text.trim()) {
      appAlert(
        '提示',
        visibleIndicesRef.current.length > 0 ? zh.chat.readEmptyVisible : zh.chat.readEmpty,
      );
      return;
    }

    void cancelAssistantFeedback();
    setSpeaking(true);
    try {
      await speakText(text, {
        onDone: () => setSpeaking(false),
        onStopped: () => setSpeaking(false),
        onError: () => setSpeaking(false),
      });
    } catch {
      setSpeaking(false);
    }
  };

  const renderMessage = ({ item }: { item: ChatUiMessageRow }) => {
    const isUser = item.role === 'user';
    const isPending = item.status === 'pending';
    const isError = item.status === 'error';
    const bubbleContent = chatBubbleText(item);
    const selfName = user?.displayName ?? '我';
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

    const markProps = {
      onBubbleLongPress: (anchor: MessageBubbleAnchor) => openBubbleAction(item, anchor),
      contextExcluded: item.llmExclude?.active === true,
    };

    if (!isUser && !isError) {
      const showMetaFootnote = Boolean(
        item.llmReply || isPending || item.llmExclude?.active,
      );
      return row(
        <ChatMessageRow
          isSelf={false}
          avatarSpacer
          avatarName=""
          avatarSeed="assistant"
          showTimestamp={item.showTimestamp}
          timeLabel={item.timeLabel}
          senderName={showMetaFootnote ? undefined : assistantName}
          llmReply={item.llmReply ?? null}
          metaModelLabel={
            isPending && !item.llmReply
              ? zenmuxChatModelLabel(chatModel)
              : undefined
          }
          {...markProps}
        >
          {isPending ? (
            <View style={styles.pendingRow}>
              <ActivityIndicator color={colors.primary} size="small" />
              <Text style={[chatBubbleTextStyle.text, styles.pendingText]}>
                {bubbleContent || thinkingLine}
              </Text>
            </View>
          ) : (
            <ChatMessageContent content={bubbleContent} messageSelectionKey={item.id} />
          )}
        </ChatMessageRow>,
      );
    }

    return row(
      <ChatMessageRow
        isSelf={isUser}
        avatarName={selfName}
        avatarSeed={user?.id ?? 'me'}
        avatarImageUri={user?.avatarDisplayUrl}
        showTimestamp={item.showTimestamp}
        timeLabel={item.timeLabel}
        layout={isError ? 'system' : 'bubble'}
        llmInvoke={isUser ? item.llmInvoke : null}
        {...markProps}
      >
        {isPending ? (
          <View style={styles.pendingRow}>
            <ActivityIndicator color={colors.primary} size="small" />
            <Text style={[chatBubbleTextStyle.text, styles.pendingText]}>
              {bubbleContent || thinkingLine}
            </Text>
          </View>
        ) : (
          <ChatMessageContent content={bubbleContent} messageSelectionKey={item.id} />
        )}
        {isError && item.retryText ? (
          <Pressable
            style={styles.retryBtn}
            onPress={() => void sendText(item.retryText!)}
            disabled={sending}
          >
            <Text style={styles.retryBtnText}>{zh.common.retry}</Text>
          </Pressable>
        ) : null}
      </ChatMessageRow>,
    );
  };

  const canReadReply = messages.some((m) => m.role === 'assistant' && m.status === 'done');

  const composeFooter = (
    <View ref={composeRef} collapsable={false}>
      {pendingIntent && session?.id ? (
        <IntentChipBar
          analyze={pendingIntent.analyze}
          onSelectIntent={(kind, slots) => {
            void (async () => {
              setSending(true);
              try {
                const ok = await runIntentExecute(
                  session.id,
                  pendingIntent.text,
                  kind,
                  slots,
                );
                if (ok) setInput('');
              } finally {
                setSending(false);
              }
            })();
          }}
          onSelectMemoryTarget={(fragmentId, kind) => {
            void (async () => {
              setSending(true);
              try {
                const ok = await runIntentExecute(
                  session.id,
                  pendingIntent.text,
                  kind,
                  pendingIntent.analyze.slots,
                  fragmentId,
                );
                if (ok) setInput('');
              } finally {
                setSending(false);
              }
            })();
          }}
          onDismiss={() => setPendingIntent(null)}
        />
      ) : null}
        <SlashCommandsTip
          visible={messages.length === 0 && !pendingIntent && !input.trim()}
        />
      <ChatComposeBar
        value={input}
        onChangeText={setInput}
        onSend={() => void sendText(input)}
        onSendVoiceText={(t) => void sendText(t)}
        placeholder={zh.chat.placeholder}
        contextUsage={contextUsage}
        contextUsageLoading={contextUsageLoading}
        onPickImage={(asset) => {
          if (!asset.base64) return;
          void (async () => {
            try {
              const res = await api.ocrImage({
                imageBase64: asset.base64!,
                mimeType: asset.mimeType ?? 'image/jpeg',
              });
              const text = res.data.text?.trim();
              if (text) {
                setInput((v) => (v ? `${v}\n${text}` : text));
              } else {
                appAlert('提示', '图片里没认出文字');
              }
            } catch (e) {
              appAlert('识图失败', apiErrorText(e).message);
            }
          })();
        }}
        busy={sending}
        bottomInset={8}
        reserveContextSlot
      />
    </View>
  );

  const headerRight = (
    <View style={styles.headerActions}>
      <Pressable
        style={[
          styles.headerIconBtn,
          speaking && styles.headerIconBtnActive,
          !canReadReply && !speaking && styles.headerIconBtnDisabled,
        ]}
        onPress={() => void toggleReadAloud()}
        disabled={!canReadReply && !speaking}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={speaking ? zh.writing.stopReading : zh.writing.readMode}
      >
        <ChatUiIcon source={chatIcons.readAloud} size={22} active={speaking || canReadReply} />
      </Pressable>
      <Pressable
        style={styles.headerIconBtn}
        onPress={() =>
          session?.id
            ? navigateBrainTab(navigation, 'SettingsMemory', {
                scope: 'session',
                sessionId: session.id,
              })
            : undefined
        }
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={zh.me.sessionMemoryTitle}
      >
        <Text style={styles.headerMemLink}>记忆</Text>
      </Pressable>
      <Pressable
        style={styles.headerIconBtn}
        onPress={() => navigation.navigate('SettingsLlmLogs')}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={zh.me.llmLogTitle}
      >
        <Text style={styles.headerMemLink}>日志</Text>
      </Pressable>
      <Pressable
        style={styles.headerIconBtn}
        onPress={() => setToolsOpen(true)}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={zh.chat.openTools}
      >
        <ChatUiIcon source={chatIcons.topics} size={22} />
      </Pressable>
    </View>
  );

  return (
    <View style={[wechatChatStyles.page, styles.pageHost]}>
      <View
        onStartShouldSetResponderCapture={() => {
          bubbleTextSelectionClearActive();
          return false;
        }}
      >
        <WeChatChatHeader
          title={chatSessionHeaderTitle(session)}
          showBack
          right={headerRight}
          onTitlePress={session ? () => void renameSession() : undefined}
          onTitleLongPress={session ? () => void renameSession() : undefined}
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
            onViewableItemsChanged={onViewableItemsChanged}
            viewabilityConfig={viewabilityConfig}
            contentContainerStyle={
              messagesUi.length === 0 ? styles.listContentEmpty : wechatChatStyles.listContent
            }
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            onScrollBeginDrag={bubbleTextSelectionClearActive}
            onTouchEndCapture={bubbleTextSelectionTryDismissOnTouchEnd}
            removeClippedSubviews={Platform.OS !== 'android'}
            initialNumToRender={20}
            maxToRenderPerBatch={12}
            windowSize={9}
            updateCellsBatchingPeriod={50}
            renderItem={renderMessage}
            onScrollToIndexFailed={(info) => {
              setTimeout(() => {
                listRef.current?.scrollToIndex({
                  index: info.index,
                  animated: false,
                  viewPosition: 0.45,
                });
              }, 100);
            }}
            onContentSizeChange={() => {
              if (!pendingScrollMessageIdRef.current) {
                onListContentSizeChange();
              }
            }}
            ListEmptyComponent={
              <Text style={[styles.empty, isTablet && styles.emptyTablet]}>
                {zh.chat.emptyHint}
              </Text>
            }
          />
          <DraggableAskAiFab
            active={false}
            onTap={() => setAskAiHubOpen(true)}
            onLongPress={() => setAskAiHubOpen(true)}
          />
        </View>
        <View
          onStartShouldSetResponderCapture={() => {
            bubbleTextSelectionClearActive();
            return false;
          }}
        >
          {composeFooter}
        </View>
        </BubbleTextSelectionProvider>
      </KeyboardAvoidingView>

      <AskAiHubSheet
        visible={askAiHubOpen}
        onClose={() => setAskAiHubOpen(false)}
        onChangeModel={() => setModelPickerOpen(true)}
        onComposeContext={() => setComposerOpen(true)}
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
        source="chat"
        sessionId={session?.id}
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
          messageAction?.message.role === 'user' &&
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

      <WritingAssistantSheet
        visible={toolsOpen}
        title={zh.chat.sideTitle}
        closeLabel={zh.chat.closeTools}
        onClose={() => setToolsOpen(false)}
      >
        <ChatToolsPanel
          sessions={sessions}
          currentSessionId={session?.id ?? null}
          sending={sending}
          canReadReply={canReadReply}
          onNewSession={() => {
            void newSession();
          }}
          onSelectSession={(sessionId) => {
            void switchSession(sessionId).then(() => setToolsOpen(false));
          }}
          onRenameSession={(s) => {
            void renameSession(s);
          }}
          onReadReply={() => {
            readLastAssistant();
            setToolsOpen(false);
          }}
        />
      </WritingAssistantSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  pageHost: { position: 'relative' },
  flex: { flex: 1 },
  chatBody: { flex: 1, position: 'relative', minHeight: 0 },
  messageHighlight: {
    backgroundColor: 'rgba(255, 152, 0, 0.14)',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
  },
  pendingRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  headerIconBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
  },
  headerIconBtnActive: {
    backgroundColor: 'rgba(0,0,0,0.06)',
  },
  headerIconBtnDisabled: {
    opacity: 0.35,
  },
  headerMemLink: {
    fontSize: 13,
    color: colors.primary,
    fontWeight: '600',
  },
  messageCell: {
    flexGrow: 0,
    flexShrink: 0,
    width: '100%',
  },
  listContentEmpty: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 16 },
  pendingText: { flex: 1, color: colors.textMuted },
  retryBtn: {
    marginTop: 12,
    alignSelf: 'flex-start',
    backgroundColor: colors.primary,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
  },
  retryBtnText: { color: colors.onPrimary, fontWeight: '600', fontSize: typography.caption },
  empty: {
    fontSize: typography.body,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: 40,
    lineHeight: typography.bodyLineHeight,
  },
  emptyTablet: { fontSize: typography.body, marginTop: 56 },
});
