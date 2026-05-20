import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewToken,
} from 'react-native';
import type { TextInput } from 'react-native';
import type {
  ContextSelection,
  ContextUsage,
  Revision,
  WritingUnderstandingScope,
} from '@xzz/shared';
import * as Clipboard from 'expo-clipboard';
import { appAlert } from '../lib/appAlert';
import { api } from '../lib/api';
import {
  getAssistantContinueLine,
  getAssistantThinkingLine,
  getAssistantThinkingLongLine,
} from '../lib/assistantCopy';
import {
  announceAssistantReplyParallel,
  announceAssistantWaiting,
  cancelAssistantFeedback,
} from '../lib/assistantFeedback';
import { apiErrorText } from '../lib/apiError';
import { animateTypewriter } from '../lib/typewriter';
import { isSpeaking, speakText, stopSpeaking } from '../lib/tts';
import {
  collectWritingAssistantRepliesFromScreen,
  writingBubbleText,
  type WritingUiMessage,
} from '../lib/uiMessage';
import { AssistantComposeDock } from './AssistantComposeDock';
import { AskAiHubSheet } from './AskAiHubSheet';
import { AskAiModelPickerSheet } from './AskAiModelPickerSheet';
import { DraggableAskAiFab } from './DraggableAskAiFab';
import { ContextComposerModal } from './ContextComposerModal';
import { ContextUsageDetailModal } from './ContextUsageDetailModal';
import { ChatMessageActionMenu } from './chat/ChatMessageActionMenu';
import { useMessageActionViewport } from '../hooks/useMessageActionViewport';
import type { MessageBubbleAnchor } from './chat/MessageBubbleAnchor';
import { openMessageAction, type MessageActionTarget } from '../lib/messageActionMenu';
import { getChatLlmModel, setChatLlmModel } from '../lib/chatLlmModel';
import type { AssistantHeaderReadAloud } from './WritingAssistantSheet';
import { attachChatTimeFlags } from '../lib/chatTime';
import { ChatMessageContent } from './chat/ChatMessageContent';
import { ChatMessageRow, chatBubbleTextStyle } from './ChatMessageRow';
import { prepareChatMessageForSend } from '../lib/chatMessageInput';
import { colors, typography } from '../theme/colors';
import { wechatChatStyles } from '../theme/wechatChat';
import { useLayout } from '../theme/layout';
import { zh } from '../locales/zh-CN';

function localMessage(
  documentId: string,
  role: WritingUiMessage['role'],
  content: string,
  kind: WritingUiMessage['kind'] = 'chat',
  extra?: Partial<WritingUiMessage>,
): WritingUiMessage {
  return {
    id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    documentId,
    role,
    content,
    kind,
    createdAt: new Date().toISOString(),
    status: 'done',
    ...extra,
  };
}

export interface AiRevisionResult {
  revision: Revision;
  oldText: string;
  newText: string;
  comment: string;
  createdAt: string;
  retryAction?: string;
  retryInstruction?: string;
}

export interface WritingAssistantChapterPayload {
  chapterId: string;
  chapterTitle: string;
  chapterContent: string;
  documentExcerpt: string;
  hasMultipleChapters: boolean;
}

interface Props {
  documentId: string;
  blockId: string;
  articleExcerpt: string;
  chapterContext: WritingAssistantChapterPayload;
  disabled?: boolean;
  /** 最近一次改稿建议（含已保持原样，仍可「看一看」） */
  suggestionRevision?: Revision | null;
  onViewSuggestion?: () => void | Promise<void>;
  /** 浮层打开时滚到最新消息 */
  scrollToLatestOnOpen?: boolean;
  onBeforeExecute?: () => Promise<void>;
  onRevisionReady: (result: AiRevisionResult) => void;
  /** 嵌入右侧弹窗时隐藏顶部标题（由弹窗头部展示） */
  showTitle?: boolean;
  /** 弹窗打开后自动聚焦输入框并唤起键盘 */
  autoFocusCompose?: boolean;
  ocrBusy?: boolean;
  onStartOcr?: () => void;
  /** 将「开始朗读」挂到右侧浮层标题栏（仅 showTitle=false 时使用） */
  onHeaderReadAloud?: (config: AssistantHeaderReadAloud | null) => void;
}

export function WritingAssistantPanel({
  documentId,
  blockId,
  articleExcerpt,
  chapterContext,
  disabled,
  suggestionRevision,
  onViewSuggestion,
  scrollToLatestOnOpen = false,
  onBeforeExecute,
  onRevisionReady,
  showTitle = true,
  autoFocusCompose = false,
  ocrBusy = false,
  onStartOcr,
  onHeaderReadAloud,
}: Props) {
  const { bodyFontSize, bodyLineHeight, replyLineHeight, buttonFontSize, captionFontSize } =
    useLayout();
  const [messages, setMessages] = useState<WritingUiMessage[]>([]);
  const [input, setInput] = useState('');
  const [contextDetailUsage, setContextDetailUsage] = useState<ContextUsage | null>(null);
  const [inFlight, setInFlight] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [thinkingLine, setThinkingLine] = useState<string>(zh.writing.thinkingZh);
  const [thinkingLongLine, setThinkingLongLine] = useState<string>(zh.writing.thinkingLongZh);
  const [speaking, setSpeaking] = useState(false);
  const [understandingScope, setUnderstandingScope] =
    useState<WritingUnderstandingScope>('chapter');
  const [contextUsage, setContextUsage] = useState<ContextUsage | null>(null);
  const [contextUsageLoading, setContextUsageLoading] = useState(false);
  const [askAiHubOpen, setAskAiHubOpen] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [chatModel, setChatModel] = useState('moonshotai/kimi-k2.6');
  const [contextSelection, setContextSelection] = useState<ContextSelection | null>(null);
  const [messageAction, setMessageAction] = useState<MessageActionTarget<WritingUiMessage> | null>(
    null,
  );
  const [messageActionBusy, setMessageActionBusy] = useState(false);
  const listRef = useRef<FlatList>(null);
  const listHostRef = useRef<View>(null);
  const composeAnchorRef = useRef<View>(null);
  const composeRef = useRef<TextInput>(null);
  const typewriterAbortRef = useRef<AbortController | null>(null);
  const visibleIndicesRef = useRef<number[]>([]);
  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 15,
    minimumViewTime: 0,
  }).current;
  const messagesUi = useMemo(() => attachChatTimeFlags(messages), [messages]);
  const { viewport: messageActionViewport, composeRect: messageActionComposeRect } =
    useMessageActionViewport(listHostRef, composeAnchorRef, messageAction !== null);

  useEffect(() => {
    void getChatLlmModel().then(setChatModel);
  }, []);

  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      visibleIndicesRef.current = viewableItems
        .filter((v) => v.isViewable && v.index != null)
        .map((v) => v.index as number);
    },
  ).current;

  useEffect(() => {
    if (!autoFocusCompose) return;
    const timer = setTimeout(() => composeRef.current?.focus(), 320);
    return () => clearTimeout(timer);
  }, [autoFocusCompose]);

  const scrollToEnd = useCallback((animated = true) => {
    const run = () => listRef.current?.scrollToEnd({ animated });
    run();
    setTimeout(run, 120);
    setTimeout(() => listRef.current?.scrollToEnd({ animated: false }), 360);
  }, []);

  const refreshContextUsage = useCallback(
    async (pending?: string) => {
      setContextUsageLoading(true);
      try {
        const res = await api.getWritingAssistantContextUsage(documentId, {
          chapterTitle: chapterContext.chapterTitle,
          chapterContent: chapterContext.chapterContent,
          documentExcerpt: chapterContext.documentExcerpt,
          pending,
        });
        setContextUsage(res.data);
      } catch {
        setContextUsage(null);
      } finally {
        setContextUsageLoading(false);
      }
    },
    [
      documentId,
      chapterContext.chapterTitle,
      chapterContext.chapterContent,
      chapterContext.documentExcerpt,
    ],
  );

  const patchMessageFromServer = useCallback(
    (updated: WritingUiMessage) => {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === updated.id ? { ...updated, status: m.status ?? 'done' } : m,
        ),
      );
      void refreshContextUsage(input);
    },
    [input, refreshContextUsage],
  );

  const handleCopyMessage = useCallback(async () => {
    if (!messageAction?.copyText.trim()) return;
    await Clipboard.setStringAsync(messageAction.copyText);
    setMessageAction(null);
  }, [messageAction]);

  const handleMarkLlmExclude = useCallback(async () => {
    if (!messageAction) return;
    setMessageActionBusy(true);
    try {
      const res = await api.markWritingLlmExclude(documentId, messageAction.message.id);
      patchMessageFromServer({ ...res.data, status: 'done' });
      setMessageAction(null);
    } catch (e) {
      appAlert('标记失败', apiErrorText(e).message);
    } finally {
      setMessageActionBusy(false);
    }
  }, [documentId, messageAction, patchMessageFromServer]);

  const handleCancelLlmExclude = useCallback(async () => {
    if (!messageAction) return;
    setMessageActionBusy(true);
    try {
      const res = await api.cancelWritingLlmExclude(documentId, messageAction.message.id);
      patchMessageFromServer({ ...res.data, status: 'done' });
      setMessageAction(null);
    } catch (e) {
      appAlert('取消标记失败', apiErrorText(e).message);
    } finally {
      setMessageActionBusy(false);
    }
  }, [documentId, messageAction, patchMessageFromServer]);

  const loadMessages = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await api.getWritingAssistantMessages(documentId);
      setMessages(
        res.data.map((m) => ({
          ...m,
          kind: m.kind ?? 'chat',
          status: 'done' as const,
        })),
      );
      scrollToEnd();
      void refreshContextUsage();
    } catch (e) {
      const { message, hint } = apiErrorText(e);
      setLoadError(hint ? `${message}\n${hint}` : message);
    }
  }, [documentId, scrollToEnd, refreshContextUsage]);

  useEffect(() => {
    void loadMessages();
  }, [loadMessages, documentId]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void refreshContextUsage(input);
    }, 300);
    return () => clearTimeout(timer);
  }, [
    documentId,
    input,
    chapterContext.chapterTitle,
    chapterContext.chapterContent,
    chapterContext.documentExcerpt,
    refreshContextUsage,
  ]);

  useEffect(() => {
    if (!scrollToLatestOnOpen || messages.length === 0) return;
    scrollToEnd(false);
    const t1 = setTimeout(() => scrollToEnd(false), 200);
    const t2 = setTimeout(() => scrollToEnd(false), 520);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [scrollToLatestOnOpen, messages.length, scrollToEnd]);

  const reloadWaitingCopy = useCallback(() => {
    void (async () => {
      setThinkingLine(await getAssistantThinkingLine());
      setThinkingLongLine(await getAssistantThinkingLongLine());
    })();
  }, []);

  useEffect(() => {
    reloadWaitingCopy();
  }, [documentId, reloadWaitingCopy]);

  useEffect(() => {
    if (autoFocusCompose) reloadWaitingCopy();
  }, [autoFocusCompose, reloadWaitingCopy]);

  useEffect(() => {
    return () => {
      typewriterAbortRef.current?.abort();
      void cancelAssistantFeedback();
      void stopSpeaking();
    };
  }, []);

  const canReadReply = messages.some(
    (m) =>
      m.role === 'assistant' &&
      m.status !== 'pending' &&
      m.status !== 'streaming' &&
      m.status !== 'error' &&
      writingBubbleText(m).trim().length > 0,
  );

  const toggleReadAloud = useCallback(async () => {
    if (await isSpeaking()) {
      await stopSpeaking();
      setSpeaking(false);
      return;
    }

    const text = collectWritingAssistantRepliesFromScreen(messages, visibleIndicesRef.current);
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
  }, [messages]);

  useEffect(() => {
    if (!onHeaderReadAloud || showTitle) return;
    onHeaderReadAloud({
      speaking,
      canRead: canReadReply,
      onToggle: () => void toggleReadAloud(),
    });
    return () => onHeaderReadAloud(null);
  }, [onHeaderReadAloud, showTitle, speaking, canReadReply, toggleReadAloud]);

  useEffect(() => {
    if (!inFlight) return;
    const timer = setTimeout(() => {
      setMessages((prev) =>
        prev.map((m) =>
          m.status === 'pending'
            ? { ...m, displayContent: thinkingLongLine }
            : m,
        ),
      );
    }, 28_000);
    return () => clearTimeout(timer);
  }, [inFlight, thinkingLongLine]);

  const revealMessage = useCallback(
    async (messageId: string, fullText: string) => {
      typewriterAbortRef.current?.abort();
      const ac = new AbortController();
      typewriterAbortRef.current = ac;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId
            ? { ...m, status: 'streaming', content: fullText, displayContent: '' }
            : m,
        ),
      );
      await animateTypewriter(
        fullText,
        (visible) => {
          setMessages((prev) =>
            prev.map((m) => (m.id === messageId ? { ...m, displayContent: visible } : m)),
          );
          scrollToEnd();
        },
        { signal: ac.signal },
      );
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId ? { ...m, status: 'done', displayContent: undefined } : m,
        ),
      );
    },
    [scrollToEnd],
  );

  const sendText = useCallback(
    async (text: string) => {
      const trimmed = prepareChatMessageForSend(text);
      if (!trimmed || inFlight || disabled) return;

      const userId = `local-user-${Date.now()}`;
      const assistantId = `local-asst-${Date.now()}`;
      const userMsg = localMessage(documentId, 'user', trimmed, 'chat', { id: userId });
      const pendingAssistant = localMessage(documentId, 'assistant', '', 'chat', {
        id: assistantId,
        status: 'pending',
        displayContent: thinkingLine,
        retryText: trimmed,
      });

      setInput('');
      setMessages((prev) => [...prev, userMsg, pendingAssistant]);
      scrollToEnd();
      void announceAssistantWaiting(thinkingLine);
      setInFlight(true);

      try {
        const res = await api.sendWritingAssistantMessage(documentId, {
          content: trimmed,
          articleExcerpt,
          chapterId: chapterContext.chapterId,
          chapterTitle: chapterContext.chapterTitle,
          chapterContent: chapterContext.chapterContent,
          documentExcerpt: chapterContext.documentExcerpt,
          contextSelection: contextSelection ?? undefined,
        });
        const serverUser = res.data.user;
        const serverAssistant = res.data.assistant;
        const fullText = serverAssistant.content;

        announceAssistantReplyParallel(fullText);

        setMessages((prev) => {
          const rest = prev.filter((m) => m.id !== userId && m.id !== assistantId);
          return [
            ...rest,
            { ...serverUser, status: 'done' },
            {
              ...serverAssistant,
              id: assistantId,
              status: 'streaming',
              content: fullText,
              displayContent: '',
            },
          ];
        });
        await revealMessage(assistantId, fullText);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...serverAssistant, status: 'done', displayContent: undefined }
              : m,
          ),
        );
        if (res.data.contextUsage) {
          setContextUsage(res.data.contextUsage);
        }
        scrollToEnd();
      } catch (e) {
        const { message, hint } = apiErrorText(e);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  status: 'error',
                  content: hint ? `${message}\n\n${hint}` : message,
                  displayContent: undefined,
                  retryText: trimmed,
                }
              : m,
          ),
        );
        scrollToEnd();
      } finally {
        setInFlight(false);
      }
    },
    [
      documentId,
      articleExcerpt,
      chapterContext,
      disabled,
      inFlight,
      revealMessage,
      scrollToEnd,
      thinkingLine,
      contextSelection,
    ],
  );

  const send = () => void sendText(input);

  const confirmIntent = async (
    messageId: string,
    approved: boolean,
    scope: WritingUnderstandingScope = understandingScope,
  ) => {
    if (inFlight || disabled) return;

    const intentMessage = messages.find((m) => m.id === messageId);
    const pendingId = `local-pending-${Date.now()}`;
    const beforeIds = new Set(messages.map((m) => m.id));

    const waitingLine = approved ? await getAssistantContinueLine() : await getAssistantThinkingLine();
    setMessages((prev) => [
      ...prev.map((m) =>
        m.id === messageId && approved
          ? { ...m, confirmStatus: 'approved' as const }
          : m,
      ),
      localMessage(documentId, 'assistant', '', 'notice', {
        id: pendingId,
        status: 'pending',
        displayContent: waitingLine,
        retryConfirm: { messageId, approved, understandingScope: scope },
      }),
    ]);
    scrollToEnd();
    void announceAssistantWaiting(waitingLine);
    setInFlight(true);

    try {
      await onBeforeExecute?.();
      const res = await api.confirmWritingAssistant(documentId, {
        messageId,
        approved,
        blockId,
        articleExcerpt,
        chapterId: chapterContext.chapterId,
        chapterTitle: chapterContext.chapterTitle,
        chapterContent: chapterContext.chapterContent,
        documentExcerpt: chapterContext.documentExcerpt,
        understandingScope: scope,
      });

      const fresh = await api.getWritingAssistantMessages(documentId);
      const newOnes = fresh.data.filter((m) => !beforeIds.has(m.id));

      setMessages(
        fresh.data.map((m) => {
          const isNew = newOnes.some((n) => n.id === m.id);
          const base = { ...m, kind: m.kind ?? ('chat' as const) };
          return isNew
            ? { ...base, status: 'streaming' as const, displayContent: '', content: m.content }
            : { ...base, status: 'done' as const };
        }),
      );
      scrollToEnd();

      for (const m of newOnes) {
        if (m.role === 'assistant' && m.content.trim()) {
          announceAssistantReplyParallel(m.content);
        }
        await revealMessage(m.id, m.content);
      }

      if (res.data.contextUsage) {
        setContextUsage(res.data.contextUsage);
      }

      if (approved && res.data.revision && res.data.oldText != null) {
        const intentIdx = messages.findIndex((m) => m.id === messageId);
        const lastUserBeforeIntent =
          intentIdx > 0
            ? [...messages.slice(0, intentIdx)].reverse().find((m) => m.role === 'user')
            : undefined;
        const baseParts = [
          lastUserBeforeIntent?.content?.trim(),
          intentMessage?.pendingInstruction?.trim(),
        ].filter(Boolean);
        onRevisionReady({
          revision: res.data.revision,
          oldText: res.data.oldText,
          newText: res.data.newText!,
          comment: res.data.comment ?? '',
          createdAt: res.data.revision.createdAt,
          retryAction: intentMessage?.pendingAction ?? '润色',
          retryInstruction: baseParts.join('\n'),
        });
      }
      scrollToEnd();
    } catch (e) {
      const err = e as Error & { code?: string; hint?: string };
      if (err.code === 'NOT_FOUND' || err.code === 'REVISION_NOT_FOUND') {
        await loadMessages();
      }
      const { message, hint } = apiErrorText(e);
      setMessages((prev) =>
        prev
          .filter((m) => m.id !== pendingId)
          .concat(
            localMessage(documentId, 'assistant', hint ? `${message}\n\n${hint}` : message, 'notice', {
              status: 'error',
              retryConfirm: { messageId, approved, understandingScope: scope },
            }),
          ),
      );
      scrollToEnd();
    } finally {
      setInFlight(false);
    }
  };

  const userBubbleTextStyle = {
    fontSize: bodyFontSize,
    lineHeight: bodyLineHeight,
    color: colors.text,
  };
  const assistantBubbleTextStyle = {
    fontSize: bodyFontSize,
    lineHeight: replyLineHeight,
    color: colors.text,
  };

  const renderItem = ({
    item,
  }: {
    item: WritingUiMessage & { showTimestamp: boolean; timeLabel: string };
  }) => {
    const isUser = item.role === 'user';
    const isPending = item.status === 'pending';
    const isError = item.status === 'error';
    const text = writingBubbleText(item);
    const showConfirm =
      item.kind === 'intent_confirm' &&
      item.confirmStatus === 'pending' &&
      !disabled &&
      !inFlight;

    const messageKind = item.kind ?? 'chat';
    const isRevisionReady = messageKind === 'revision_ready' && !isUser && !isError;
    const useSystemLayout = isRevisionReady || isError;

    const bubbleBody = isPending ? (
      <View style={styles.pendingRow}>
        <ActivityIndicator color={colors.primary} size="small" />
        <Text
          style={[
            useSystemLayout ? wechatChatStyles.systemText : chatBubbleTextStyle.text,
            userBubbleTextStyle,
            styles.pendingText,
          ]}
        >
          {text || thinkingLine}
        </Text>
      </View>
    ) : useSystemLayout ? (
      <Text
        style={[
          wechatChatStyles.systemText,
          !isUser && assistantBubbleTextStyle,
          isUser && userBubbleTextStyle,
        ]}
      >
        {text}
      </Text>
    ) : (
      <ChatMessageContent content={text} />
    );

    const canMarkContext =
      (messageKind === 'chat' || messageKind === 'notice') && !isPending && !isError;

    return (
      <View style={styles.messageCell}>
      <ChatMessageRow
        isSelf={isUser}
        avatarName={isUser ? '我' : zh.writing.assistantTitle}
        avatarSeed={isUser ? 'writing-user' : 'writing-assistant'}
        showTimestamp={item.showTimestamp}
        timeLabel={item.timeLabel}
        layout={useSystemLayout ? 'system' : 'bubble'}
        hideAvatar
        onBubbleLongPress={
          useSystemLayout
            ? undefined
            : (anchor: MessageBubbleAnchor) =>
                openMessageAction(
                  {
                    message: item,
                    copyText: text,
                    anchor,
                    canMark: canMarkContext,
                  },
                  setMessageAction,
                )
        }
        contextExcluded={item.llmExclude?.active === true}
      >
        {bubbleBody}
          {showConfirm ? (
            <View style={styles.confirmBlock}>
              {chapterContext.hasMultipleChapters ? (
                <>
                  <Text style={[styles.scopeTitle, { fontSize: captionFontSize }]}>
                    {zh.writing.assistantScopeTitle}
                  </Text>
                  <Text style={[styles.scopeHint, { fontSize: captionFontSize }]}>
                    {zh.writing.assistantScopeHint}
                  </Text>
                  <View style={styles.scopeRow}>
                    <Pressable
                      style={[
                        styles.scopeChip,
                        understandingScope === 'chapter' && styles.scopeChipActive,
                      ]}
                      onPress={() => setUnderstandingScope('chapter')}
                      disabled={inFlight}
                    >
                      <Text
                        style={[
                          styles.scopeChipText,
                          { fontSize: captionFontSize },
                          understandingScope === 'chapter' && styles.scopeChipTextActive,
                        ]}
                      >
                        {zh.writing.assistantScopeChapter}
                      </Text>
                    </Pressable>
                    <Pressable
                      style={[
                        styles.scopeChip,
                        understandingScope === 'document' && styles.scopeChipActive,
                      ]}
                      onPress={() => setUnderstandingScope('document')}
                      disabled={inFlight}
                    >
                      <Text
                        style={[
                          styles.scopeChipText,
                          { fontSize: captionFontSize },
                          understandingScope === 'document' && styles.scopeChipTextActive,
                        ]}
                      >
                        {zh.writing.assistantScopeDocument}
                      </Text>
                    </Pressable>
                  </View>
                  <Text style={[styles.scopeHint, { fontSize: captionFontSize }]}>
                    {understandingScope === 'document'
                      ? zh.writing.assistantScopeDocumentHint
                      : zh.writing.assistantScopeChapterHint}
                  </Text>
                </>
              ) : null}
              <View style={styles.confirmRow}>
                <Pressable
                  style={styles.confirmYes}
                  onPress={() => void confirmIntent(item.id, true, understandingScope)}
                  disabled={inFlight}
                >
                  <Text style={styles.confirmYesText}>{zh.writing.assistantConfirmYes}</Text>
                </Pressable>
                <Pressable
                  style={styles.confirmNo}
                  onPress={() => void confirmIntent(item.id, false)}
                  disabled={inFlight}
                >
                  <Text style={styles.confirmNoText}>{zh.writing.assistantConfirmNo}</Text>
                </Pressable>
              </View>
            </View>
          ) : null}
          {isError && item.retryText ? (
            <Pressable
              style={styles.retryBtn}
              onPress={() => void sendText(item.retryText!)}
              disabled={inFlight}
            >
              <Text style={styles.retryBtnText}>{zh.common.retry}</Text>
            </Pressable>
          ) : null}
          {isError && item.retryConfirm ? (
            <Pressable
              style={styles.retryBtn}
              onPress={() =>
                void confirmIntent(
                  item.retryConfirm!.messageId,
                  item.retryConfirm!.approved,
                  item.retryConfirm!.understandingScope ?? understandingScope,
                )
              }
              disabled={inFlight}
            >
              <Text style={styles.retryBtnText}>{zh.common.retry}</Text>
            </Pressable>
          ) : null}
      </ChatMessageRow>
      </View>
    );
  };

  return (
    <View style={styles.panel}>
      {contextDetailUsage ? (
        <View style={styles.contextOverlay} pointerEvents="box-none">
          <Pressable
            style={styles.contextBackdrop}
            onPress={() => setContextDetailUsage(null)}
            accessibilityRole="button"
            accessibilityLabel={zh.context.close}
          />
          <View style={styles.contextCardWrap} pointerEvents="box-none">
            <ContextUsageDetailModal
              visible
              inline
              usage={contextDetailUsage}
              onClose={() => setContextDetailUsage(null)}
            />
          </View>
        </View>
      ) : null}
      {showTitle ? <Text style={styles.panelTitle}>{zh.writing.assistantTitle}</Text> : null}
      <View ref={listHostRef} style={styles.listHost} collapsable={false}>
        <FlatList
          ref={listRef}
          style={styles.list}
          data={messagesUi}
          keyExtractor={(m) => m.id}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={viewabilityConfig}
          renderItem={renderItem}
          contentContainerStyle={
            messagesUi.length === 0 && !loadError
              ? styles.listContentEmpty
              : styles.listContent
          }
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            loadError ? (
              <Text style={[styles.loadError, { fontSize: captionFontSize, lineHeight: bodyLineHeight }]}>
                {loadError}
              </Text>
            ) : (
              <Text style={[styles.emptyHint, { fontSize: captionFontSize, lineHeight: bodyLineHeight }]}>
                {zh.writing.assistantEmpty}
              </Text>
            )
          }
        />
        <DraggableAskAiFab
          active={false}
          onTap={() => setAskAiHubOpen(true)}
          onLongPress={() => setAskAiHubOpen(true)}
        />
      </View>
      {suggestionRevision && onViewSuggestion ? (
        <Pressable
          style={styles.viewSuggestionBar}
          onPress={() => void onViewSuggestion()}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel={zh.writing.viewSuggestion}
        >
          <Text style={[styles.viewSuggestionBarText, { fontSize: buttonFontSize }]}>
            {zh.writing.viewSuggestion}
          </Text>
        </Pressable>
      ) : null}
      <View ref={composeAnchorRef} collapsable={false}>
        <AssistantComposeDock
          inputRef={composeRef}
          input={input}
          onChangeText={setInput}
          onSend={send}
          onVoiceText={(t) => void sendText(t)}
          onPickImage={
            onStartOcr && !disabled && !inFlight && !ocrBusy ? onStartOcr : undefined
          }
          disabled={disabled}
          busy={inFlight || ocrBusy}
          contextUsage={contextUsage}
          contextUsageLoading={contextUsageLoading}
          onContextDetailOpen={setContextDetailUsage}
          onContextRingLongPress={() => setAskAiHubOpen(true)}
        />
      </View>
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
        source="writing"
        documentId={documentId}
        chapterTitle={chapterContext.chapterTitle}
        chapterContent={chapterContext.chapterContent}
        documentExcerpt={chapterContext.documentExcerpt}
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
        markActive={messageAction?.message.llmExclude?.active === true}
        busy={messageActionBusy}
        onClose={() => setMessageAction(null)}
        onCopy={() => void handleCopyMessage()}
        onMark={() => void handleMarkLlmExclude()}
        onCancelMark={() => void handleCancelLlmExclude()}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    flex: 1,
    minHeight: 0,
    backgroundColor: wechatChatStyles.page.backgroundColor,
    position: 'relative',
  },
  contextOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 30,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  contextBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.backdrop,
  },
  contextCardWrap: {
    width: '100%',
    maxWidth: 320,
    zIndex: 1,
  },
  panelTitle: {
    fontSize: typography.caption,
    fontWeight: '600',
    color: colors.textMuted,
    marginBottom: 8,
    textAlign: 'center',
  },
  listHost: { flex: 1, minHeight: 0, position: 'relative' },
  list: { flex: 1 },
  messageCell: {
    flexGrow: 0,
    flexShrink: 0,
    width: '100%',
  },
  listContent: {
    paddingBottom: 12,
    paddingTop: 8,
    paddingHorizontal: 0,
  },
  listContentEmpty: { flexGrow: 1, justifyContent: 'center' },
  pendingSpinner: { marginTop: 6 },
  pendingRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    flexShrink: 0,
  },
  pendingText: { flex: 1, color: colors.textMuted },
  emptyHint: { fontSize: typography.caption, color: colors.textMuted, textAlign: 'center', padding: 16 },
  loadError: {
    fontSize: typography.caption,
    color: colors.error,
    textAlign: 'center',
    padding: 16,
    lineHeight: typography.bodyLineHeight,
  },
  retryBtn: {
    marginTop: 12,
    alignSelf: 'flex-start',
    backgroundColor: colors.primary,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
  },
  retryBtnText: { color: colors.onPrimary, fontWeight: '600', fontSize: typography.caption },
  confirmBlock: { marginTop: 12, gap: 8 },
  scopeTitle: { fontWeight: '700', color: colors.text },
  scopeHint: { color: colors.textMuted, lineHeight: typography.bodyLineHeight },
  scopeRow: { flexDirection: 'row', gap: 8 },
  scopeChip: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    alignItems: 'center',
  },
  scopeChipActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
  },
  scopeChipText: { color: colors.textMuted, fontWeight: '600', textAlign: 'center' },
  scopeChipTextActive: { color: colors.text },
  confirmRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  confirmYes: {
    flex: 1,
    backgroundColor: colors.primary,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
  },
  confirmYesText: { color: colors.onPrimary, fontWeight: '600', fontSize: typography.caption },
  confirmNo: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: colors.background,
  },
  confirmNoText: { color: colors.text, fontWeight: '600', fontSize: typography.caption },
  viewSuggestionBar: {
    marginBottom: 10,
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingVertical: 16,
    alignItems: 'center',
    minHeight: 56,
    justifyContent: 'center',
  },
  viewSuggestionBarText: {
    color: colors.onPrimary,
    fontWeight: '700',
  },
});
