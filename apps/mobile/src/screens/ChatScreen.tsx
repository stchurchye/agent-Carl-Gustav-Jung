import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
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
  type PixelAvatarSettings,
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
import {
  ASSISTANT_FALLBACK_NAME,
  DEFAULT_SESSION_TITLE,
  isDefaultSessionTitle,
} from '../lib/brand';
import { navigateBrainTab } from '../lib/navigateBrain';
import { buildPrivateStage } from '../features/stage/adapters/privateStageAdapter';
import { resolveStageCharacter } from '../features/stage/stageCharacters';
import { StageView } from '../features/stage/components/StageView';
import { StageHistoryOverlay } from '../features/stage/components/StageHistoryOverlay';
import type { StageActor, StageLine } from '../features/stage/stageTypes';
import { apiErrorText } from '../lib/apiError';
import { isAuthErrorMessage } from '../lib/authEvents';
import {
  announceAssistantReplyParallel,
  announceAssistantWaiting,
  cancelAssistantFeedback,
} from '../lib/assistantFeedback';
import { isSpeaking, speakChinese, speakText, stopSpeaking } from '../lib/tts';
import { animateTypewriter } from '../lib/typewriter';
import {
  chatBubbleText,
  collectAssistantRepliesFromScreen,
  getAgentRunIdFromMessage,
  type ChatUiMessage,
} from '../lib/uiMessage';
import { AgentRunCard } from '../features/agent/AgentRunCard';
import { useAgentModelPicker } from '../features/agent/useAgentModelPicker';
import { AgentModelPickerSheet } from '../features/agent/AgentModelPickerSheet';
import { zenmuxChatModelLabel } from '../lib/chatLlmModel';
import { attachChatTimeFlags } from '../lib/chatTime';
import {
  dedupeById,
  getCachedMessages,
  mergeMessagesById,
  setCachedMessages,
} from '../lib/chatMessageCache';
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
import { useHideTabBar } from '../navigation/useHideTabBar';
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

function chatSessionHeaderTitle(session: ChatSession | null): string {
  const title = session?.title?.trim();
  if (title && !isDefaultSessionTitle(title)) return title;
  return zh.chat.title;
}

type Props = NativeStackScreenProps<GroupStackParamList, 'PrivateChat'>;

export function ChatScreen({ route, navigation }: Props) {
  const initialSessionId = route.params?.sessionId;
  const scrollToMessageId = route.params?.scrollToMessageId;
  const insets = useSafeAreaInsets();
  useHideTabBar();
  const { user } = useAuth();
  const { isTablet } = useLayout();
  const textStyles = useTextStyles();
  const [assistantName, setAssistantName] = useState(ASSISTANT_FALLBACK_NAME);
  const [session, setSession] = useState<ChatSession | null>(null);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [messages, setMessages] = useState<ChatUiMessage[]>([]);
  // 首载指示:仅在「无缓存可显」时兜底渲染 spinner(缓存命中则瞬时出内容)。
  const [initialLoading, setInitialLoading] = useState(true);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const thinkingLine = useMemo(() => zh.chat.thinking(assistantName), [assistantName]);
  const thinkingLongLine = useMemo(() => zh.chat.thinkingLong(assistantName), [assistantName]);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [contextUsage, setContextUsage] = useState<ContextUsage | null>(null);
  const [contextUsageLoading, setContextUsageLoading] = useState(false);
  const [chatModel, setChatModel] = useState<string>('moonshotai/kimi-k2.6');
  const {
    current: agentModel,
    missingKeys: agentMissingKeys,
    sheetVisible: agentSheetVisible,
    setSheetVisible: setAgentSheetVisible,
    pick: pickAgentModel,
  } = useAgentModelPicker();
  const [askAiHubOpen, setAskAiHubOpen] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [contextSelection, setContextSelection] = useState<ContextSelection | null>(null);
  const listHostRef = useRef<View>(null);
  const composeRef = useRef<View>(null);
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
  // dedupeById:渲染层最后防线,任何路径残留的重复 id 在喂给 FlatList 前收敛(重复 key 是 React 硬错误)。
  const messagesUi = useMemo(() => attachChatTimeFlags(dedupeById(messages)), [messages]);
  const {
    listRef,
    listOpacityStyle,
    highlightMessageId,
    scrollToEnd,
    followIfStuck,
    viewportListProps,
  } = useChatListViewport({
    resetKey: session?.id,
    messages: messagesUi,
    scrollToMessageId,
    onScrollBeginDrag: bubbleTextSelectionClearActive,
  });
  const { viewport: messageActionViewport, composeRect: messageActionComposeRect } =
    useMessageActionViewport(listHostRef, composeRef, messageAction !== null);

  // ---- 像素舞台模式:经典列表整体迁入"点角色看历史"浮层 ----
  const { height: windowHeight } = useWindowDimensions();
  const [historyOpen, setHistoryOpen] = useState<boolean>(Boolean(scrollToMessageId));
  const stageBubbleMaxHeight = Math.max(180, Math.round(windowHeight * 0.42));
  const pixelMap = useMemo(() => {
    const m = new Map<string, PixelAvatarSettings | null | undefined>();
    m.set('self', user?.pixelAvatar);
    if (user) m.set(user.id, user.pixelAvatar);
    return m;
  }, [user]);
  const resolveCharacter = useCallback(
    (actor: StageActor) => resolveStageCharacter(actor, pixelMap),
    [pixelMap],
  );
  const stage = useMemo(() => {
    const built = buildPrivateStage(messagesUi, {
      userId: user?.id ?? 'me',
      userName: user?.displayName ?? '我',
      userAvatarUri: user?.avatarDisplayUrl,
      assistantName,
    });
    if (built.lines.length === 0 && !initialLoading) {
      // 空会话:狗狗给一条欢迎台词(原 ListEmptyComponent 的舞台化)
      built.lines.push({
        id: 'stage-empty-hint',
        actorId: 'dog:self',
        text: zh.chat.emptyHint(assistantName),
        kind: 'chat',
        createdAt: '',
      });
    }
    return built;
  }, [messagesUi, user, assistantName, initialLoading]);

  // useFocusEffect 而非挂载一次:从「狗狗的名字」设置屏返回、或对话改名后切屏回来都要刷新
  useFocusEffect(
    useCallback(() => {
      void api.getPersona().then((r) => {
        setAssistantName(personaAssistantDisplayName(r.data));
      }).catch(() => {});
    }, []),
  );

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
        s.title?.trim() && !isDefaultSessionTitle(s.title)
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

  // W1b:刷新对缓存做引用稳定 merge —— 未变消息复用旧引用,整体未变时连重渲染都没有。
  // loadSeqRef:切会话时在途响应乱序返回会把旧会话消息渲染进新会话(review-w1),序号守卫丢弃过期响应。
  const loadSeqRef = useRef(0);
  const loadMessages = useCallback(
    async (sessionId: string) => {
      const seq = ++loadSeqRef.current;
      const res = await api.getChatMessages(sessionId);
      if (seq !== loadSeqRef.current) return;
      const fresh = res.data.map((m) => ({ ...m, status: 'done' as const }));
      const merged = mergeMessagesById(getCachedMessages<ChatUiMessage>(sessionId) ?? [], fresh);
      setCachedMessages(sessionId, merged);
      // preserveLocal:别吞掉发送中的乐观占位(local-*)——后台刷新/agent 占位重拉与
      // 在途发送并发时,直接 setMessages(merged) 会把正在发的消息从屏上抹掉(review P0)。
      setMessages((prev) => mergeMessagesById(prev, merged, { preserveLocal: true }));
    },
    [],
  );

  // 进屏/切会话先渲染缓存(stale-while-revalidate),不再等网络白屏。
  const seedFromCache = useCallback((sessionId: string) => {
    setMessages(getCachedMessages<ChatUiMessage>(sessionId) ?? []);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (initialSessionId) {
        const list = await refreshSessions();
        const found = list.find((s) => s.id === initialSessionId);
        if (cancelled) return;
        if (found) {
          setSession(found);
          seedFromCache(found.id);
          await loadMessages(found.id);
          return;
        }
      }
      const id = await ensureSession();
      if (cancelled) return;
      seedFromCache(id);
      await loadMessages(id);
    })().finally(() => {
      if (!cancelled) setInitialLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [initialSessionId, ensureSession, loadMessages, refreshSessions]);

  const sessionIdRef = useRef<string | null>(null);
  const messageCountRef = useRef(0);
  sessionIdRef.current = session?.id ?? null;
  messageCountRef.current = messages.length;

  // 本地变更(发送/流式/撤回)也回写缓存,重开会话不丢最新视图。
  // sessionId 字段守卫:切会话瞬间旧列表不写进新会话的缓存键。
  useEffect(() => {
    const sid = session?.id;
    if (!sid) return;
    const settled = messages.filter(
      (m) => (m.status ?? 'done') === 'done' && !m.id.startsWith('local-') && m.sessionId === sid,
    );
    if (settled.length > 0) setCachedMessages(sid, settled);
  }, [messages, session?.id]);

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
          // 流式跟随：仅当用户仍粘底才跟到底，不强制粘底 —— 用户流式中上滑看
          // 历史不会被每 tick 拽回。（兜底 onContentSizeChange 可能漏触发的情形。）
          followIfStuck();
        },
        { signal: ac.signal },
      );
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId ? { ...m, status: 'done', displayContent: undefined } : m,
        ),
      );
    },
    [followIfStuck],
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
        // M5B: agentModel comes from useAgentModelPicker hook state (no async needed).
        const agentOptions =
          kind === 'agent_run'
            ? { providerId: agentModel.providerId, modelId: agentModel.modelId }
            : undefined;
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
          agentOptions,
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
          onAgent: async () => {
            // Agent run 占位消息已在后端写入 db,
            // 直接重新拉取会话消息让 AgentRunCard 接管渲染。
            setMessages((prev) => prev.filter((m) => m.id !== assistantId));
            await loadMessages(sessionId);
          },
          onPersonaUpdated: (settings) => {
            setAssistantName(personaAssistantDisplayName(settings));
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
      agentModel,
      announceAssistantReplyParallel,
      announceAssistantWaiting,
      chatModel,
      contextSelection,
      loadMessages,
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
      seedFromCache(sessionId);
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

    const agentRunId = getAgentRunIdFromMessage(item);
    if (agentRunId) {
      return row(<AgentRunCard runId={agentRunId} />);
    }

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
        <Pressable
          onPress={() => setAgentSheetVisible(true)}
          style={styles.agentModelChip}
        >
          <Text style={styles.agentModelChipText}>
            {zh.chat.agentModelPrefix}: {agentModel.label} ▾
          </Text>
        </Pressable>
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
                appAlert('提示', zh.chat.ocrNoText);
              }
            } catch (e) {
              appAlert('识图失败', apiErrorText(e).message);
            }
          })();
        }}
        busy={sending}
        bottomInset={Math.max(insets.bottom, 8)}
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
          <StageView
            actors={stage.actors}
            lines={stage.lines}
            resolveCharacter={resolveCharacter}
            selfUserId={user?.id}
            maxSlots={isTablet ? 6 : 4}
            maxBubbleHeight={stageBubbleMaxHeight}
            onActorPress={() => setHistoryOpen(true)}
            onBubblePress={() => setHistoryOpen(true)}
            onRetry={(line: StageLine) => {
              if (line.retryText) void sendText(line.retryText);
            }}
            onOverflowPress={() => setHistoryOpen(true)}
          />
          {initialLoading && messagesUi.length === 0 ? (
            <View style={styles.initialLoadingOverlay} pointerEvents="none">
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : null}
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
        <StageHistoryOverlay
          visible={historyOpen}
          onClose={() => setHistoryOpen(false)}
          title={chatSessionHeaderTitle(session)}
          data={messagesUi}
          renderItem={renderMessage}
          keyExtractor={(m) => m.id}
          listRef={listRef}
          extraListProps={{
            style: [styles.flex, listOpacityStyle],
            onViewableItemsChanged,
            viewabilityConfig,
            contentContainerStyle: wechatChatStyles.listContent,
            keyboardShouldPersistTaps: 'handled',
            keyboardDismissMode: 'on-drag',
            onTouchEndCapture: bubbleTextSelectionTryDismissOnTouchEnd,
            removeClippedSubviews: Platform.OS !== 'android',
            initialNumToRender: 20,
            maxToRenderPerBatch: 12,
            windowSize: 9,
            updateCellsBatchingPeriod: 50,
            ...viewportListProps,
          }}
          overlayChildren={
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
          }
        />
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
  flex: { flex: 1 },
  chatBody: { flex: 1, position: 'relative', minHeight: 0 },
  initialLoadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  messageHighlight: {
    backgroundColor: colors.messageHighlight,
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
