import type { NavigationProp, ParamListBase } from '@react-navigation/native';
import { displayChapterTitle } from '@xzz/shared';
import { api } from './api';
import { appAlert } from './appAlert';
import { WRITING_ENABLED } from './featureFlags';
import { filterVisibleDocuments } from './documentVisibility';
import { findChapterIdForBlock } from './writingChapterPreview';
import { getCachedDocument, getCachedTabs, rememberDocument } from './writingCache';

type Nav = NavigationProp<ParamListBase>;

export type OpenWritingOptions = {
  documentId?: string;
  chapterId?: string;
  blockId?: string;
  toast?: string;
  /**
   * WRITING_ENABLED=false 时默认拒绝进入(堵旧深链/历史栈/新调用点绕过开关);
   * 「我的 → 全部文稿」是 featureFlags.ts 注释明确保留的入口,以及写作功能
   * 内部的二跳导航(改稿历史/diff 预览),用它显式放行。
   */
  allowDisabled?: boolean;
};

/** 进入文档：默认进二级段落列表；仅指定 chapterId 时直达三级编辑 */
export async function openWriting(navigation: Nav, opts?: OpenWritingOptions) {
  if (!WRITING_ENABLED && !opts?.allowDisabled) return;
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
    // 连 documentId 都没拿到就不进屏:WritingChapters 对空 id 直接 return,
    // doc 永远 null,后续所有操作都会失败 —— 不如就地报错。
    if (!documentId) {
      appAlert('打开文档失败', '网络不太顺,稍后再试一下');
      return;
    }
    navigation.navigate('WritingChapters', {
      documentId,
      documentTitle: '',
      toast: opts?.toast,
    });
  }
}
