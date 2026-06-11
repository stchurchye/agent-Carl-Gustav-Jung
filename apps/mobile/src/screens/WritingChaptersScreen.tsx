import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { Document } from '@xzz/shared';
import {
  buildChapterTitle,
  DEFAULT_CHAPTER_TYPE,
  displayChapterTitle,
  parseChapterTitle,
  type ChapterTitleParts,
} from '@xzz/shared';
import type { GroupStackParamList } from '../navigation/types';
import { api } from '../lib/api';
import { apiErrorText } from '../lib/apiError';
import { appAlert } from '../lib/appAlert';
import {
  buildPartsForNewChapter,
  groupChaptersByType,
  listChapterTypes,
  type ChapterCatalogItem,
} from '../lib/writingChapterCatalog';
import { rememberDocument } from '../lib/writingCache';
import { promptText } from '../lib/promptText';
import { ChapterNotePromptDialog } from '../components/ChapterNotePromptDialog';
import { ChapterTitlePromptDialog } from '../components/ChapterTitlePromptDialog';
import { WritingChapterCatalog } from '../components/WritingChapterCatalog';
import { WeChatChatHeader } from '../components/WeChatChatHeader';
import { colors } from '../theme/colors';
import { wechat } from '../theme/wechat';
import { wechatChatStyles } from '../theme/wechatChat';
import { zh } from '../locales/zh-CN';

type Props = NativeStackScreenProps<GroupStackParamList, 'WritingChapters'>;

type ChapterPromptState = {
  title: string;
  hint?: string;
  initial: ChapterTitleParts;
  indexEditable?: boolean;
  resolve: (value: ChapterTitleParts | null) => void;
};

type NotePromptState = {
  type: string;
  index: string;
  resolve: (note: string | null) => void;
};

export function WritingChaptersScreen({ navigation, route }: Props) {
  const { documentId, toast: routeToast } = route.params;
  const [documentTitle, setDocumentTitle] = useState(route.params.documentTitle);
  const [doc, setDoc] = useState<Document | null>(null);
  const [loading, setLoading] = useState(true);
  const [addingChapter, setAddingChapter] = useState(false);
  const [toast, setToast] = useState(routeToast);
  const [activeType, setActiveType] = useState<string>(DEFAULT_CHAPTER_TYPE);
  const [extraTypes, setExtraTypes] = useState<string[]>([]);
  const [chapterPrompt, setChapterPrompt] = useState<ChapterPromptState | null>(null);
  const [notePrompt, setNotePrompt] = useState<NotePromptState | null>(null);

  const types = useMemo(() => {
    const base = listChapterTypes(doc);
    for (const t of extraTypes) {
      if (!base.includes(t)) base.push(t);
    }
    return base;
  }, [doc, extraTypes]);
  const grouped = useMemo(() => groupChaptersByType(doc), [doc]);
  const activeItems = useMemo(() => grouped.get(activeType) ?? [], [grouped, activeType]);

  const askChapterTitle = useCallback(
    (req: Omit<ChapterPromptState, 'resolve'>) =>
      new Promise<ChapterTitleParts | null>((resolve) => {
        setChapterPrompt({ ...req, resolve });
      }),
    [],
  );

  const askChapterNote = useCallback(
    (type: string, index: string) =>
      new Promise<string | null>((resolve) => {
        setNotePrompt({ type, index, resolve });
      }),
    [],
  );

  const closeChapterPrompt = useCallback((value: ChapterTitleParts | null) => {
    setChapterPrompt((current) => {
      current?.resolve(value);
      return null;
    });
  }, []);

  const closeNotePrompt = useCallback((value: string | null) => {
    setNotePrompt((current) => {
      current?.resolve(value);
      return null;
    });
  }, []);

  const refresh = useCallback(async () => {
    if (!documentId) {
      setDoc(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await api.getDocument(documentId);
      rememberDocument(res.data);
      setDoc(res.data);
      setDocumentTitle(res.data.title);
    } catch (e) {
      appAlert(zh.studio.loadFailed, apiErrorText(e).message);
      setDoc(null);
    } finally {
      setLoading(false);
    }
  }, [documentId]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(undefined), 4000);
      return () => clearTimeout(t);
    }
  }, [toast]);

  useEffect(() => {
    if (!doc || types.includes(activeType)) return;
    const firstWithChapters = types.find((t) => (grouped.get(t)?.length ?? 0) > 0);
    setActiveType(firstWithChapters ?? DEFAULT_CHAPTER_TYPE);
  }, [doc, types, activeType, grouped]);

  const openChapter = useCallback(
    (item: ChapterCatalogItem) => {
      navigation.navigate('WritingMain', {
        documentId,
        chapterId: item.chapterId,
        chapterTitle: displayChapterTitle(item.rawTitle),
      });
    },
    [documentId, navigation],
  );

  const addChapter = useCallback(async () => {
    if (!doc || addingChapter) return;
    if (doc.chapters.length >= 50) {
      appAlert('提示', zh.writing.chapterLimit);
      return;
    }
    setAddingChapter(true);
    try {
      const parts = buildPartsForNewChapter(doc, activeType);
      const note = await askChapterNote(parts.type, parts.index);
      if (note === null) return;

      const title = buildChapterTitle({ ...parts, note });
      const res = await api.addChapter(documentId, title);
      const docData = res.data;
      rememberDocument(docData);
      const created = [...docData.chapters].sort((a, b) => b.order - a.order)[0];
      if (!created) return;

      navigation.navigate('WritingMain', {
        documentId,
        chapterId: created.id,
        chapterTitle: displayChapterTitle(created.title),
      });
    } catch (e) {
      appAlert('添加段落没成功', String(e));
    } finally {
      setAddingChapter(false);
    }
  }, [activeType, addingChapter, askChapterNote, doc, documentId, navigation]);

  const renameChapter = useCallback(
    async (item: ChapterCatalogItem) => {
      const confirmed = await askChapterTitle({
        title: zh.writing.renameChapterTitle,
        hint: `${zh.writing.renameChapterHint}\n\n当前：${displayChapterTitle(item.rawTitle)}`,
        initial: parseChapterTitle(item.rawTitle),
      });
      if (!confirmed) return;
      const newTitle = buildChapterTitle(confirmed);
      if (newTitle === item.rawTitle) return;
      try {
        const res = await api.getDocument(documentId);
        const chapters = res.data.chapters.map((c) =>
          c.id === item.chapterId ? { ...c, title: newTitle } : c,
        );
        const updated = await api.updateDocument(documentId, { chapters });
        rememberDocument(updated.data);
        setDoc(updated.data);
        if (confirmed.type !== activeType) setActiveType(confirmed.type);
      } catch (e) {
        appAlert('段备注修改没成功', String(e));
      }
    },
    [activeType, askChapterTitle, documentId],
  );

  const addChapterType = useCallback(async () => {
    const name = await promptText(
      zh.writing.addChapterTypeTitle,
      zh.writing.addChapterTypeHint,
      '',
    );
    if (name === null) return;
    const trimmed = name.trim();
    if (!trimmed) {
      appAlert('提示', zh.writing.chapterTypeEmpty);
      return;
    }
    setExtraTypes((prev) => (prev.includes(trimmed) ? prev : [...prev, trimmed]));
    setActiveType(trimmed);
  }, []);

  const headerRight = (
    <Pressable
      onPress={() => void addChapter()}
      hitSlop={12}
      style={styles.headerBtn}
      disabled={addingChapter}
      accessibilityRole="button"
      accessibilityLabel={zh.writing.addChapter}
    >
      <Text style={[styles.headerPlus, addingChapter && styles.headerPlusDisabled]}>+</Text>
    </Pressable>
  );

  return (
    <View style={wechatChatStyles.page}>
      <WeChatChatHeader
        title={zh.studio.selectDocument}
        showBack
        right={headerRight}
      />

      {toast ? (
        <View style={styles.toast}>
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      ) : null}

      {/* W2 防闪:已有文档时聚焦重拉静默刷新(setDoc 仅错误时清),只有首载才占屏 spinner */}
      {loading && !doc ? (
        <ActivityIndicator style={styles.loader} color={colors.primary} />
      ) : (
        <WritingChapterCatalog
          types={types}
          activeType={activeType}
          items={activeItems}
          onSelectType={setActiveType}
          onAddType={() => void addChapterType()}
          onPressChapter={openChapter}
          onLongPressChapter={(item) => void renameChapter(item)}
        />
      )}

      <ChapterNotePromptDialog
        visible={notePrompt !== null}
        typeLabel={notePrompt?.type ?? ''}
        indexLabel={notePrompt?.index ?? ''}
        onCancel={() => closeNotePrompt(null)}
        onConfirm={(note) => closeNotePrompt(note)}
      />

      <ChapterTitlePromptDialog
        visible={chapterPrompt !== null}
        title={chapterPrompt?.title ?? ''}
        hint={chapterPrompt?.hint}
        initial={chapterPrompt?.initial ?? { type: '段', index: '1', note: '' }}
        indexEditable={chapterPrompt?.indexEditable ?? true}
        onCancel={() => closeChapterPrompt(null)}
        onConfirm={(parts) => closeChapterPrompt(parts)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  loader: { marginTop: 48 },
  headerBtn: {
    paddingRight: 4,
    paddingLeft: 8,
    justifyContent: 'center',
  },
  headerPlus: {
    fontSize: 30,
    fontWeight: '300',
    color: wechat.textPrimary,
    lineHeight: 32,
  },
  headerPlusDisabled: {
    opacity: 0.4,
  },
  toast: {
    backgroundColor: colors.insertBg,
    padding: 12,
    marginHorizontal: 16,
    marginTop: 8,
    borderRadius: 8,
  },
  toastText: { fontSize: 12, color: colors.text, textAlign: 'center' },
});
