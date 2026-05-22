import type { NavigationProp, ParamListBase } from '@react-navigation/native';
import { displayChapterTitle } from '@xzz/shared';
import { api } from './api';
import { filterVisibleDocuments } from './documentVisibility';
import { findChapterIdForBlock } from './writingChapterPreview';
import { getCachedDocument, getCachedTabs, rememberDocument } from './writingCache';

type Nav = NavigationProp<ParamListBase>;

export type OpenWritingOptions = {
  documentId?: string;
  chapterId?: string;
  blockId?: string;
  toast?: string;
};

/** 进入文档：默认进二级段落列表；仅指定 chapterId 时直达三级编辑 */
export async function openWriting(navigation: Nav, opts?: OpenWritingOptions) {
  let documentId = opts?.documentId;
  let chapterId = opts?.chapterId;

  try {
    if (!documentId) {
      const cached = getCachedTabs();
      if (cached[0]?.id) {
        documentId = cached[0].id;
      } else {
        const res = await api.listDocuments();
        const visible = filterVisibleDocuments(res.data);
        if (visible.length === 0) {
          const created = await api.createDocument('未命名文稿');
          documentId = created.data.id;
          rememberDocument(created.data);
        } else {
          documentId = visible[0].id;
        }
      }
    }

    let doc = getCachedDocument(documentId);
    if (!doc) {
      const res = await api.getDocument(documentId);
      doc = res.data;
      rememberDocument(doc);
    }

    if (!chapterId && opts?.blockId) {
      chapterId = findChapterIdForBlock(doc, opts.blockId);
    }

    const sorted = [...doc.chapters].sort((a, b) => a.order - b.order);
    const documentTitle = doc.title;

    if (chapterId) {
      const ch = sorted.find((c) => c.id === chapterId);
      navigation.navigate('WritingMain', {
        documentId,
        chapterId,
        chapterTitle: ch ? displayChapterTitle(ch.title) : undefined,
        toast: opts?.toast,
      });
      return;
    }

    navigation.navigate('WritingChapters', {
      documentId,
      documentTitle,
      toast: opts?.toast,
    });
  } catch {
    navigation.navigate('WritingChapters', {
      documentId: documentId ?? '',
      documentTitle: '',
      toast: opts?.toast,
    });
  }
}
