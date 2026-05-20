import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { appAlert } from '../lib/appAlert';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  buildChapterTitle,
  buildWritingAssistantChapterContext,
  displayChapterTitle,
  normalizeWritingDocument,
  parseChapterTitle,
  type ChapterTitleParts,
  type Document,
  type Revision,
} from '@xzz/shared';
import { api } from '../lib/api';
import { clientLog } from '../lib/clientLog';
import { openDiffPreview } from '../lib/openDiffPreview';
import { pickReadPortion, type ReadPortionMode, type TextSelection } from '../lib/readAloud';
import { cancelAssistantFeedback } from '../lib/assistantFeedback';
import { isSpeaking, speakText, stopSpeaking } from '../lib/tts';
import { AppTextInput } from '../components/AppTextInput';
import { LoadErrorView } from '../components/LoadErrorView';
import { ReconnectBanner } from '../components/ReconnectBanner';
import {
  getCachedDocument,
  rememberDocument,
} from '../lib/writingCache';
import { ChapterShareCard } from '../components/ChapterShareCard';
import { WritingAssistantPanel } from '../components/WritingAssistantPanel';
import { OcrChapterPickerModal } from '../components/OcrChapterPickerModal';
import { OcrConfirmModal } from '../components/OcrConfirmModal';
import { OcrLoadingModal } from '../components/OcrLoadingModal';
import { OcrOptionModal } from '../components/OcrOptionModal';
import { OcrPlacementBar } from '../components/OcrPlacementBar';
import {
  insertTextAtOffset,
  type OcrPlacementTarget,
} from '../lib/ocrInsert';
import { pickAssistantOcrImage, type PickedOcrImage } from '../lib/assistantOcrSession';
import { recognizeImageFromAsset } from '../lib/recognizeImage';
import { apiErrorText } from '../lib/apiError';
import { promptText } from '../lib/promptText';
import {
  WritingAssistantSheet,
  type AssistantHeaderReadAloud,
} from '../components/WritingAssistantSheet';
import {
  copyChapterText,
  ensureSaveToAlbumPermission,
  saveChapterImageToAlbum,
  type ChapterSharePayload,
} from '../lib/chapterShare';
import { ChapterTitlePromptDialog } from '../components/ChapterTitlePromptDialog';
import { WritingBottomBar } from '../components/WritingBottomBar';
import { WeChatChatHeader } from '../components/WeChatChatHeader';
import { colors, typography } from '../theme/colors';
import { useLayout } from '../theme/layout';
import { wechatChatStyles } from '../theme/wechatChat';
import { zh } from '../locales/zh-CN';
import type { GroupStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<GroupStackParamList, 'WritingMain'>;

const writingType = {
  body: 15,
  bodyLineHeight: 22,
  caption: 12,
  small: 11,
  button: 14,
} as const;

export function WritingScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const { isTablet } = useLayout();
  const {
    documentId,
    chapterId,
    chapterTitle: routeChapterTitle,
    toast: routeToast,
    startOcrFlexible,
  } = route.params;
  const editorFontSize = isTablet ? 16 : writingType.body;
  const editorLineHeight = isTablet ? 24 : writingType.bodyLineHeight;
  const [doc, setDoc] = useState<Document | null>(null);
  const [docLoading, setDocLoading] = useState(false);
  const [docError, setDocError] = useState<string | null>(null);
  const [toast, setToast] = useState(routeToast);
  const [bodyDraft, setBodyDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [readHint, setReadHint] = useState<string | null>(null);
  const [selection, setSelection] = useState<TextSelection>({ start: 0, end: 0 });
  const [activeChapterId, setActiveChapterId] = useState<string | null>(chapterId);
  const [addingChapter, setAddingChapter] = useState(false);
  /** 最近一次改稿建议（保持原样后仍可「看一看」） */
  const [suggestionRevision, setSuggestionRevision] = useState<Revision | null>(null);
  const hasPendingSuggestion = suggestionRevision?.status === 'pending';
  const [sharing, setSharing] = useState(false);
  const [sharePayload, setSharePayload] = useState<ChapterSharePayload | null>(null);
  const shareCardRef = useRef<View>(null);
  const pendingOcrFlexibleRef = useRef(startOcrFlexible === true);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantHeaderRead, setAssistantHeaderRead] = useState<AssistantHeaderReadAloud | null>(
    null,
  );
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrLoadingVisible, setOcrLoadingVisible] = useState(false);
  const [ocrConfirmVisible, setOcrConfirmVisible] = useState(false);
  const [ocrInsertWhereVisible, setOcrInsertWhereVisible] = useState(false);
  const [ocrInsertHowVisible, setOcrInsertHowVisible] = useState(false);
  const [ocrChapterPickerVisible, setOcrChapterPickerVisible] = useState(false);
  const [ocrPlacementActive, setOcrPlacementActive] = useState(false);
  const [ocrPlacementFlexible, setOcrPlacementFlexible] = useState(false);
  const [ocrPlacementTarget, setOcrPlacementTarget] = useState<OcrPlacementTarget | null>(
    null,
  );
  const [ocrDraft, setOcrDraft] = useState('');
  type ChapterPromptState = {
    title: string;
    hint?: string;
    initial: ChapterTitleParts;
    indexEditable?: boolean;
    resolve: (value: ChapterTitleParts | null) => void;
  };
  const [chapterPrompt, setChapterPrompt] = useState<ChapterPromptState | null>(null);

  const askChapterTitle = useCallback(
    (req: Omit<ChapterPromptState, 'resolve'>) =>
      new Promise<ChapterTitleParts | null>((resolve) => {
        setChapterPrompt({ ...req, resolve });
      }),
    [],
  );

  const closeChapterPrompt = useCallback((value: ChapterTitleParts | null) => {
    setChapterPrompt((current) => {
      current?.resolve(value);
      return null;
    });
  }, []);

  const openAssistant = useCallback(() => {
    Keyboard.dismiss();
    setAssistantOpen(true);
  }, []);

  const closeAssistant = useCallback(() => {
    setAssistantOpen(false);
    setAssistantHeaderRead(null);
    void cancelAssistantFeedback();
  }, []);

  const applyDocument = useCallback((raw: Document) => {
    const { doc: normalized, changed } = normalizeWritingDocument(raw);
    rememberDocument(normalized);
    setDoc(normalized);
    if (changed) {
      void api
        .updateDocument(normalized.id, { chapters: normalized.chapters })
        .then((res) => {
          rememberDocument(res.data);
          setDoc(res.data);
        })
        .catch(() => {});
    }
    return normalized;
  }, []);

  const loadDoc = useCallback(async (id: string) => {
    setDocLoading(true);
    setDocError(null);
    try {
      const res = await api.getDocument(id);
      applyDocument(res.data);
      setDocError(null);
    } catch (e) {
      const cached = getCachedDocument(id);
      if (cached) {
        applyDocument(cached);
      } else {
        setDoc(null);
      }
      setDocError(String(e));
    } finally {
      setDocLoading(false);
    }
  }, [applyDocument]);

  useEffect(() => {
    void loadDoc(documentId);
  }, [documentId, loadDoc]);

  useEffect(() => {
    if (!doc) return;
    const { doc: normalized, changed } = normalizeWritingDocument(doc);
    if (!changed) return;
    rememberDocument(normalized);
    setDoc(normalized);
    void api
      .updateDocument(normalized.id, { chapters: normalized.chapters })
      .catch(() => {});
  }, [doc]);

  const sortedChapters = useMemo(
    () => [...(doc?.chapters ?? [])].sort((a, b) => a.order - b.order),
    [doc?.chapters],
  );

  const activeChapter = useMemo(
    () => sortedChapters.find((ch) => ch.id === activeChapterId) ?? sortedChapters[0],
    [sortedChapters, activeChapterId],
  );

  const activeBlock = activeChapter?.blocks?.[0] ?? null;

  const assistantChapterContext = useMemo(() => {
    if (!doc || !activeChapter) return null;
    return buildWritingAssistantChapterContext(doc, activeChapter.id, bodyDraft);
  }, [doc, activeChapter, bodyDraft]);

  useEffect(() => {
    setActiveChapterId(chapterId);
  }, [chapterId]);

  useEffect(() => {
    if (!doc) return;
    if (!doc.chapters.some((ch) => ch.id === chapterId)) {
      navigation.replace('WritingChapters', {
        documentId,
        documentTitle: doc.title,
      });
    }
  }, [chapterId, doc, documentId, navigation]);

  useEffect(() => {
    setBodyDraft(activeBlock?.content ?? '');
    setSelection({ start: 0, end: 0 });
  }, [activeChapter?.id, activeBlock?.id, activeBlock?.content]);

  const refreshSuggestionRevision = useCallback(async () => {
    if (!doc || !activeBlock) {
      setSuggestionRevision(null);
      return;
    }
    try {
      const res = await api.listRevisions(doc.id);
      const pending = res.data.find(
        (r) => r.status === 'pending' && r.blockId === activeBlock.id,
      );
      if (pending) {
        setSuggestionRevision(pending);
        return;
      }
      setSuggestionRevision((prev) => {
        if (!prev || prev.blockId !== activeBlock.id) return null;
        const inList = res.data.find((r) => r.id === prev.id);
        if (inList?.status === 'accepted') return null;
        return prev;
      });
    } catch {
      // 网络失败时保留本地缓存，便于离线再看一眼
    }
  }, [doc, activeBlock]);

  useFocusEffect(
    useCallback(() => {
      void refreshSuggestionRevision();
      if (docError) void loadDoc(documentId);
    }, [docError, documentId, loadDoc, refreshSuggestionRevision]),
  );

  useEffect(() => {
    void refreshSuggestionRevision();
  }, [activeBlock?.id, refreshSuggestionRevision]);

  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(undefined), 4000);
      return () => clearTimeout(t);
    }
  }, [toast]);

  useEffect(() => {
    return () => {
      void stopSpeaking();
    };
  }, []);

  const readingLabel = (mode: ReadPortionMode) => {
    if (mode === 'selection') return zh.writing.readingSelection;
    if (mode === 'fromCursor') return zh.writing.readingFromCursor;
    return zh.writing.reading;
  };

  const toggleReadAloud = async () => {
    if (!bodyDraft.trim()) {
      appAlert('提示', zh.writing.readEmpty);
      return;
    }
    if (await isSpeaking()) {
      await stopSpeaking();
      setSpeaking(false);
      setReadHint(null);
      return;
    }

    const portion = pickReadPortion(bodyDraft, selection);
    if (!portion.text.trim()) {
      appAlert('提示', zh.writing.readEmptyAfterCursor);
      return;
    }

    setSpeaking(true);
    setReadHint(readingLabel(portion.mode));
    try {
      await speakText(portion.text, {
        onDone: () => {
          setSpeaking(false);
          setReadHint(null);
        },
        onStopped: () => {
          setSpeaking(false);
          setReadHint(null);
        },
        onError: () => {
          setSpeaking(false);
          setReadHint(null);
        },
      });
    } catch {
      setSpeaking(false);
      setReadHint(null);
    }
  };

  const switchChapter = async (nextChapterId: string) => {
    if (nextChapterId === activeChapterId) return;
    await saveBody();
    const ch = doc?.chapters.find((c) => c.id === nextChapterId);
    navigation.replace('WritingMain', {
      documentId,
      chapterId: nextChapterId,
      chapterTitle: ch ? displayChapterTitle(ch.title) : undefined,
    });
    void stopSpeaking();
    setSpeaking(false);
    setReadHint(null);
  };

  useEffect(() => {
    if (!sharePayload) return;

    let cancelled = false;

    const run = async () => {
      await new Promise((resolve) => setTimeout(resolve, 320));
      if (cancelled) return;
      try {
        await saveChapterImageToAlbum(shareCardRef);
        appAlert('好了', zh.writing.shareImageSaved);
      } catch (e) {
        const msg = String(e);
        if (msg.includes('PERMISSION_DENIED')) {
          appAlert('提示', zh.writing.sharePermissionDenied);
        } else {
          appAlert('提示', zh.writing.shareImageFailed);
        }
      } finally {
        if (!cancelled) {
          setSharePayload(null);
          setSharing(false);
        }
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [sharePayload]);

  const buildSharePayload = (): ChapterSharePayload | null => {
    if (!doc || !activeChapter) return null;
    const text = bodyDraft.trim();
    if (!text) return null;
    return {
      documentTitle: doc.title,
      chapterTitle: displayChapterTitle(activeChapter.title),
      body: text,
    };
  };

  const prepareSharePayload = async (): Promise<ChapterSharePayload | null> => {
    if (!doc || !activeChapter || sharing) return null;
    await saveBody();
    const payload = buildSharePayload();
    if (!payload) {
      appAlert('提示', zh.writing.shareEmpty);
      return null;
    }
    return payload;
  };

  const handleCopyChapter = () => {
    void (async () => {
      const payload = await prepareSharePayload();
      if (!payload) return;
      try {
        await copyChapterText(payload);
        appAlert('好了', zh.writing.shareCopyDone);
      } catch {
        appAlert('提示', '复制没成功，请稍后再试');
      }
    })();
  };

  const handleGenerateChapterImage = () => {
    void (async () => {
      const payload = await prepareSharePayload();
      if (!payload) return;
      try {
        await ensureSaveToAlbumPermission();
        setSharing(true);
        setSharePayload(payload);
      } catch {
        appAlert('提示', zh.writing.sharePermissionDenied);
      }
    })();
  };

  const persistBody = async (content: string) => {
    if (!doc || !activeChapter || !activeBlock || saving) return;
    if (content === activeBlock.content) return;
    setSaving(true);
    try {
      const chapters = doc.chapters.map((ch) =>
        ch.id !== activeChapter.id
          ? ch
          : {
              ...ch,
              blocks: ch.blocks.map((b) =>
                b.id === activeBlock.id ? { ...b, content } : b,
              ),
            },
      );
      const res = await api.updateDocument(doc.id, { chapters });
      setDoc(res.data);
    } catch (e) {
      appAlert('保存没成功', String(e));
    } finally {
      setSaving(false);
    }
  };

  const saveBody = async () => {
    await persistBody(bodyDraft);
  };

  const clearOcrDraftFlow = useCallback(() => {
    setOcrConfirmVisible(false);
    setOcrInsertWhereVisible(false);
    setOcrInsertHowVisible(false);
    setOcrChapterPickerVisible(false);
    setOcrPlacementActive(false);
    setOcrPlacementFlexible(false);
    setOcrPlacementTarget(null);
    setOcrDraft('');
  }, []);

  const cancelOcrPlacement = useCallback(() => {
    setOcrPlacementActive(false);
    setOcrPlacementFlexible(false);
    setOcrPlacementTarget(null);
    setOcrInsertWhereVisible(true);
  }, []);

  const persistChapterContent = async (
    documentId: string,
    chapterId: string,
    blockId: string,
    nextContent: string,
  ): Promise<Document | null> => {
    const fresh = await api.getDocument(documentId);
    const sourceDoc = fresh.data;
    const chapter = sourceDoc.chapters.find((c) => c.id === chapterId);
    const block = chapter?.blocks.find((b) => b.id === blockId);
    if (!chapter || !block) return null;
    const chapters = sourceDoc.chapters.map((ch) =>
      ch.id !== chapterId
        ? ch
        : {
            ...ch,
            blocks: ch.blocks.map((b) =>
              b.id === blockId ? { ...b, content: nextContent } : b,
            ),
          },
    );
    const res = await api.updateDocument(documentId, { chapters });
    return res.data;
  };

  const beginOcrPlacement = (
    opts: { flexible: boolean; target?: OcrPlacementTarget | null },
    cursorAt: number,
  ) => {
    setOcrInsertWhereVisible(false);
    setOcrInsertHowVisible(false);
    setOcrChapterPickerVisible(false);
    setOcrPlacementFlexible(opts.flexible);
    setOcrPlacementTarget(opts.flexible ? null : (opts.target ?? null));
    setOcrPlacementActive(true);
    setSelection({ start: cursorAt, end: cursorAt });
  };

  const startOcrPlacement = async (
    opts: { flexible: boolean; target?: OcrPlacementTarget | null },
    cursorAt?: number,
  ) => {
    await saveBody();
    beginOcrPlacement(opts, cursorAt ?? bodyDraft.length);
  };

  useEffect(() => {
    if (!pendingOcrFlexibleRef.current || !doc || !activeChapter || !activeBlock) return;
    pendingOcrFlexibleRef.current = false;
    beginOcrPlacement({ flexible: true }, activeBlock.content.length);
  }, [doc, activeChapter, activeBlock]);

  const runOcrRecognition = useCallback(async (asset: PickedOcrImage) => {
      setOcrLoadingVisible(true);
      try {
        const text = await recognizeImageFromAsset(asset);
        if (!text) {
          appAlert('提示', zh.writing.ocrEmpty);
          return;
        }
        setOcrDraft(text);
        setOcrConfirmVisible(true);
      } catch (e) {
        const { message, hint } = apiErrorText(e);
        appAlert('识图没成功', hint ? `${message}\n\n${hint}` : message);
      } finally {
        setOcrLoadingVisible(false);
        setOcrBusy(false);
      }
  }, []);

  const startAssistantOcr = useCallback(async () => {
    if (ocrBusy) return;
    setOcrBusy(true);
    setAssistantOpen(false);
    await new Promise((r) => setTimeout(r, 380));
    try {
      const picked = await pickAssistantOcrImage();
      if (!picked) {
        setOcrBusy(false);
        return;
      }
      await runOcrRecognition(picked);
    } catch (e) {
      appAlert('识图没成功', String(e));
      setOcrBusy(false);
    }
  }, [ocrBusy, runOcrRecognition]);

  const proceedOcrToInsertWhere = () => {
    if (!ocrDraft.trim()) {
      appAlert('提示', zh.writing.ocrConfirmEmpty);
      return;
    }
    setOcrConfirmVisible(false);
    setOcrInsertWhereVisible(true);
  };

  const backOcrToConfirm = () => {
    setOcrInsertWhereVisible(false);
    setOcrInsertHowVisible(false);
    setOcrChapterPickerVisible(false);
    setOcrConfirmVisible(true);
  };

  const finishOcrInsert = (message: string) => {
    clearOcrDraftFlow();
    appAlert('好了', message);
  };

  const handleOcrInsertCurrent = () => {
    if (!doc || !activeChapter || !activeBlock) return;
    void startOcrPlacement({
      flexible: false,
      target: {
        documentId: doc.id,
        chapterId: activeChapter.id,
        blockId: activeBlock.id,
      },
    });
  };

  const handleOcrPickOtherChapter = async (chapterId: string) => {
    if (!doc) return;
    const ch = doc.chapters.find((c) => c.id === chapterId);
    const block = ch?.blocks[0];
    if (!ch || !block) return;
    setOcrChapterPickerVisible(false);
    await switchChapter(chapterId);
    const fresh = await api.getDocument(doc.id);
    const freshCh = fresh.data.chapters.find((c) => c.id === chapterId);
    const content = freshCh?.blocks[0]?.content ?? '';
    setBodyDraft(content);
    beginOcrPlacement(
      {
        flexible: false,
        target: { documentId: doc.id, chapterId: ch.id, blockId: block.id },
      },
      content.length,
    );
  };

  const handleOcrCreateChapterForPlacement = async () => {
    if (!doc || addingChapter) return;
    if (doc.chapters.length >= 50) {
      appAlert('提示', zh.writing.chapterLimit);
      return;
    }
    setOcrInsertHowVisible(false);
    await saveBody();
    setAddingChapter(true);
    try {
      const res = await api.addChapter(doc.id);
      let docData = res.data;
      const sorted = [...docData.chapters].sort((a, b) => a.order - b.order);
      const newest = sorted[sorted.length - 1];
      if (!newest) return;

      const confirmed = await askChapterTitle({
        title: zh.writing.newChapterTitle,
        hint: zh.writing.newChapterHint,
        initial: parseChapterTitle(newest.title),
      });
      if (confirmed) {
        const newTitle = buildChapterTitle(confirmed);
        if (newTitle !== newest.title) {
          const chapters = docData.chapters.map((c) =>
            c.id === newest.id ? { ...c, title: newTitle } : c,
          );
          const renamed = await api.updateDocument(doc.id, { chapters });
          docData = renamed.data;
        }
      }
      rememberDocument(docData);
      setDoc(docData);
      setSuggestionRevision(null);
      navigation.replace('WritingMain', {
        documentId: doc.id,
        chapterId: newest.id,
        chapterTitle: displayChapterTitle(
          docData.chapters.find((c) => c.id === newest.id)?.title ?? newest.title,
        ),
        startOcrFlexible: true,
      });
    } catch (e) {
      appAlert('添加段落没成功', String(e));
      setOcrInsertHowVisible(true);
    } finally {
      setAddingChapter(false);
    }
  };

  const handleOcrCreateArticleForPlacement = async () => {
    setOcrInsertHowVisible(false);
    await saveBody();
    try {
      const res = await api.createDocument('新文稿');
      let docData = res.data;
      const prompted = await promptText(
        zh.writing.renameDocTitle,
        zh.writing.renameDocMessage,
        '新文稿',
      );
      if (prompted !== null && prompted.trim() && prompted.trim() !== '新文稿') {
        const renamed = await api.updateDocument(docData.id, { title: prompted.trim() });
        docData = renamed.data;
      }
      rememberDocument(docData);
      const first = [...docData.chapters].sort((a, b) => a.order - b.order)[0];
      if (!first) return;
      void stopSpeaking();
      setSpeaking(false);
      navigation.replace('WritingMain', {
        documentId: docData.id,
        chapterId: first.id,
        chapterTitle: displayChapterTitle(first.title),
        startOcrFlexible: true,
      });
    } catch (e) {
      appAlert(zh.writing.newDocFailed, `${String(e)}\n\n${zh.writing.newDocApiHint}`);
      setOcrInsertHowVisible(true);
    }
  };

  const confirmOcrPlacement = async () => {
    const text = ocrDraft.trim();
    if (!text) {
      appAlert('提示', zh.writing.ocrConfirmEmpty);
      return;
    }
    if (!doc || !activeChapter || !activeBlock) return;

    let target: OcrPlacementTarget;
    if (ocrPlacementFlexible) {
      target = {
        documentId: doc.id,
        chapterId: activeChapter.id,
        blockId: activeBlock.id,
      };
    } else if (ocrPlacementTarget) {
      if (
        doc.id !== ocrPlacementTarget.documentId ||
        activeChapter.id !== ocrPlacementTarget.chapterId ||
        activeBlock.id !== ocrPlacementTarget.blockId
      ) {
        appAlert('提示', zh.writing.ocrPlacementWrongChapter);
        return;
      }
      target = ocrPlacementTarget;
    } else {
      return;
    }

    const offset = Math.min(selection.start, selection.end);

    try {
      const nextContent = insertTextAtOffset(bodyDraft, offset, text);
      setBodyDraft(nextContent);
      const updated = await persistChapterContent(
        target.documentId,
        target.chapterId,
        target.blockId,
        nextContent,
      );
      if (updated) {
        rememberDocument(updated);
        setDoc(updated);
      }
      finishOcrInsert(zh.writing.ocrInsertDone);
    } catch (e) {
      appAlert('插入没成功', String(e));
    }
  };

  const ocrPlacementHint = ocrPlacementFlexible
    ? zh.writing.ocrPlacementHintFlexible
    : ocrPlacementTarget
      ? zh.writing.ocrPlacementHintChapter
      : zh.writing.ocrPlacementHintCurrent;

  const ocrPlacementTargetLabel =
    ocrPlacementFlexible && doc && activeChapter
      ? `${zh.writing.ocrPlacementTarget}${doc.title} · ${displayChapterTitle(activeChapter.title)}`
      : ocrPlacementTarget && doc
        ? (() => {
            const ch = doc.chapters.find((c) => c.id === ocrPlacementTarget.chapterId);
            return ch
              ? `${zh.writing.ocrPlacementTarget}${doc.title} · ${displayChapterTitle(ch.title)}`
              : undefined;
          })()
        : undefined;

  const headerTitle =
    activeChapter != null
      ? displayChapterTitle(activeChapter.title)
      : routeChapterTitle ?? zh.studio.writeText;

  return (
    <View style={wechatChatStyles.page}>
      <WeChatChatHeader title={headerTitle} showBack />

      {toast ? (
        <View style={styles.toast}>
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      ) : null}

      {docError && !doc ? (
        <LoadErrorView message={docError} onRetry={() => void loadDoc(documentId)} />
      ) : doc ? (
        <>
        {docError ? (
          <ReconnectBanner
            message={docError}
            onRetry={() => void loadDoc(documentId)}
          />
        ) : null}

        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={0}
        >
          <View style={styles.editorPane}>
            <AppTextInput
              style={[
                styles.bodyInput,
                isTablet && styles.bodyInputTablet,
                ocrPlacementActive && styles.bodyInputPlacement,
                { fontSize: editorFontSize, lineHeight: editorLineHeight },
              ]}
              maxFontSizeMultiplier={1.15}
              placeholder={zh.writing.bodyPlaceholder}
              placeholderTextColor={colors.textMuted}
              value={bodyDraft}
              onChangeText={setBodyDraft}
              onSelectionChange={(e) => {
                setSelection(e.nativeEvent.selection);
              }}
              onBlur={() => void saveBody()}
              multiline
              scrollEnabled
              editable
              textAlignVertical="top"
            />
            {ocrPlacementActive ? (
              <OcrPlacementBar
                hint={ocrPlacementHint}
                targetLabel={ocrPlacementTargetLabel}
                onCancel={cancelOcrPlacement}
                onConfirm={() => void confirmOcrPlacement()}
              />
            ) : null}
          </View>

          <WritingBottomBar
            bottomInset={insets.bottom}
            speaking={speaking}
            sharing={sharing}
            saving={saving}
            readHint={readHint}
            assistantDisabled={!doc || !activeChapter}
            hasPendingSuggestion={hasPendingSuggestion}
            onCopy={handleCopyChapter}
            onGenerateImage={handleGenerateChapterImage}
            onHistory={() =>
              navigation.navigate('RevisionHistory', {
                documentId: doc.id,
                title: doc.title,
              })
            }
            onReadAloud={() => void toggleReadAloud()}
            onAssistant={openAssistant}
          />
        </KeyboardAvoidingView>

        {doc && activeChapter && assistantChapterContext && activeBlock ? (
          <WritingAssistantSheet
            visible={assistantOpen}
            title={zh.writing.assistantSheetTitle}
            closeLabel={zh.writing.assistantClose}
            onClose={closeAssistant}
            headerReadAloud={assistantHeaderRead}
          >
            <WritingAssistantPanel
              showTitle={false}
              autoFocusCompose
              onHeaderReadAloud={setAssistantHeaderRead}
              documentId={doc.id}
              blockId={activeBlock.id}
              ocrBusy={ocrBusy}
              onStartOcr={() => void startAssistantOcr()}
              articleExcerpt={bodyDraft.slice(0, 2000)}
              chapterContext={assistantChapterContext}
              scrollToLatestOnOpen={assistantOpen}
              suggestionRevision={suggestionRevision}
              onViewSuggestion={async () => {
                if (!suggestionRevision) return;
                try {
                  const res = await api.listRevisions(doc.id);
                  const freshPending = res.data.find(
                    (r) => r.id === suggestionRevision.id && r.status === 'pending',
                  );
                  const rev = freshPending ?? suggestionRevision;
                  const viewOnly = !freshPending;
                  closeAssistant();
                  openDiffPreview(navigation, doc.id, rev, {
                    retryAction: '润色',
                    viewOnly,
                  });
                } catch (e) {
                  const err = e as Error & { hint?: string };
                  appAlert(err.message, err.hint);
                }
              }}
              onBeforeExecute={saveBody}
              onRevisionReady={(result) => {
                clientLog('ai.revision.ready', { documentId: doc.id });
                setSuggestionRevision(result.revision);
                openDiffPreview(navigation, doc.id, result.revision, {
                  comment: result.comment,
                  retryAction: result.retryAction,
                  retryInstruction: result.retryInstruction,
                });
              }}
            />
          </WritingAssistantSheet>
        ) : null}
        </>
      ) : (
        <View style={styles.center}>
          <Text style={styles.empty}>
            {docLoading ? zh.common.loading : zh.common.loadFailed}
          </Text>
        </View>
      )}

      <ChapterTitlePromptDialog
        visible={chapterPrompt !== null}
        title={chapterPrompt?.title ?? ''}
        hint={chapterPrompt?.hint}
        initial={chapterPrompt?.initial ?? { type: '段', index: '1', note: '' }}
        indexEditable={chapterPrompt?.indexEditable ?? true}
        onCancel={() => closeChapterPrompt(null)}
        onConfirm={(parts) => closeChapterPrompt(parts)}
      />

      <OcrLoadingModal visible={ocrLoadingVisible} />

      <OcrConfirmModal
        visible={ocrConfirmVisible}
        draft={ocrDraft}
        onChangeDraft={setOcrDraft}
        onClose={clearOcrDraftFlow}
        onNext={proceedOcrToInsertWhere}
      />

      <OcrOptionModal
        visible={ocrInsertWhereVisible}
        title={zh.writing.ocrInsertWhereTitle}
        hint={zh.writing.ocrInsertWhereHint}
        options={[
          {
            key: 'current',
            label: activeChapter
              ? `${zh.writing.ocrInsertCurrent}（${displayChapterTitle(activeChapter.title)}）`
              : zh.writing.ocrInsertCurrent,
            primary: true,
          },
          { key: 'elsewhere', label: zh.writing.ocrInsertElsewhere },
        ]}
        onSelect={(key) => {
          if (key === 'current') handleOcrInsertCurrent();
          else {
            setOcrInsertWhereVisible(false);
            setOcrInsertHowVisible(true);
          }
        }}
        onClose={backOcrToConfirm}
      />

      <OcrOptionModal
        visible={ocrInsertHowVisible}
        title={zh.writing.ocrInsertHowTitle}
        hint={zh.writing.ocrInsertHowHint}
        options={[
          { key: 'chapter', label: zh.writing.ocrInsertPickChapter, primary: true },
          { key: 'newChapter', label: zh.writing.ocrInsertNewChapter },
          { key: 'newArticle', label: zh.writing.ocrInsertNewArticle },
        ]}
        onSelect={(key) => {
          if (key === 'chapter') {
            setOcrInsertHowVisible(false);
            setOcrChapterPickerVisible(true);
          } else if (key === 'newChapter') {
            void handleOcrCreateChapterForPlacement();
          } else {
            void handleOcrCreateArticleForPlacement();
          }
        }}
        onClose={() => {
          setOcrInsertHowVisible(false);
          setOcrInsertWhereVisible(true);
        }}
      />

      <OcrChapterPickerModal
        visible={ocrChapterPickerVisible}
        chapters={sortedChapters.map((ch) => ({
          id: ch.id,
          title: displayChapterTitle(ch.title),
        }))}
        activeChapterId={activeChapterId}
        onClose={() => {
          setOcrChapterPickerVisible(false);
          setOcrInsertHowVisible(true);
        }}
        onSelect={(chapterId) => void handleOcrPickOtherChapter(chapterId)}
      />

      {sharePayload ? (
        <View style={styles.shareCaptureHost} pointerEvents="none">
          <View ref={shareCardRef} collapsable={false}>
            <ChapterShareCard
              documentTitle={sharePayload.documentTitle}
              chapterTitle={sharePayload.chapterTitle}
              body={sharePayload.body}
            />
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  editorPane: {
    flex: 1,
    minHeight: 0,
    paddingHorizontal: 10,
    paddingTop: 8,
  },
  toast: {
    backgroundColor: colors.insertBg,
    padding: 12,
    marginHorizontal: 16,
    marginTop: 8,
    borderRadius: 8,
  },
  toastText: { fontSize: writingType.caption, color: colors.text, textAlign: 'center' },
  shareCaptureHost: {
    position: 'absolute',
    top: 0,
    left: 0,
    opacity: 0.02,
    zIndex: -1,
  },
  bodyInput: {
    flex: 1,
    width: '100%',
    padding: 0,
    color: colors.text,
    backgroundColor: 'transparent',
    minHeight: 120,
  },
  bodyInputTablet: { minHeight: 200 },
  bodyInputPlacement: {
    borderColor: colors.primary,
    borderWidth: 2,
  },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  empty: { fontSize: writingType.body, color: colors.textMuted },
});
