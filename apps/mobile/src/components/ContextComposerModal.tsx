import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  defaultSelectedBlockIds,
  exclusionFromBlocks,
  formatMessagesAsMarkdown,
  selectedBlockIdsFromExclusion,
  usesExclusionMode,
  type ContextPreview,
  type ContextPreviewBlock,
  type ContextSelection,
} from '@xzz/shared';
import { api } from '../lib/api';
import { apiErrorText } from '../lib/apiError';
import { ContextUsageDetailContent } from './ContextUsageDetailModal';
import { ContextPreviewBlockRow } from './ContextPreviewBlockRow';
import { typography } from '../theme/colors';
import { brainTokens } from '../theme/brainTokens';
import { zh } from '../locales/zh-CN';
import { presetDogForSeed } from '@xzz/shared';
import { usePersona } from '../hooks/usePersona';
import { PixelCharacter } from './pixel/PixelCharacter';
import { buildDogCharacter } from '../pixel/buildDog';
import { PERSONALITY_MOTION } from '../pixel/palette';

export type ContextComposerSource = 'group' | 'chat' | 'writing';

type Props = {
  visible: boolean;
  source: ContextComposerSource;
  pendingText: string;
  initialSelection?: ContextSelection | null;
  onClose: () => void;
  onApply: (selection: ContextSelection) => void;
  groupId?: string;
  topicId?: string;
  sessionId?: string;
  documentId?: string;
  chapterTitle?: string;
  chapterContent?: string;
  documentExcerpt?: string;
};

function selectableBlocks(blocks: ContextPreviewBlock[]): ContextPreviewBlock[] {
  return blocks.filter((b) => b.selectable && !b.omittedByBudget);
}

export function ContextComposerModal({
  visible,
  source,
  pendingText,
  initialSelection,
  onClose,
  onApply,
  groupId,
  topicId,
  sessionId,
  documentId,
  chapterTitle = '',
  chapterContent = '',
  documentExcerpt = '',
}: Props) {
  const [preview, setPreview] = useState<ContextPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [promptExpanded, setPromptExpanded] = useState(false);

  // 标题旁的小狗(会呼吸眨眼):用自己的狗,没领养按兜底预设
  const { dog: personaDog } = usePersona();
  const headerDog = personaDog ?? presetDogForSeed('bowwow').dog;

  const fetchPreview = useCallback(
    async (blockIds: string[], sel?: ContextSelection) => {
      setLoading(true);
      setError(null);
      try {
        let data: ContextPreview;
        const pending = pendingText.trim() || '…';
        if (source === 'group' && groupId && topicId) {
          const res = await api.getGroupContextPreview(groupId, topicId, {
            pending,
            contextSelection: sel,
          });
          data = res.data;
        } else if (source === 'chat' && sessionId) {
          const res = await api.getChatContextPreview(sessionId, {
            pending,
            contextSelection: sel,
          });
          data = res.data;
        } else if (source === 'writing' && documentId) {
          const res = await api.getWritingContextPreview(documentId, {
            chapterTitle,
            chapterContent,
            documentExcerpt,
            pending,
            contextSelection: sel,
          });
          data = res.data;
        } else {
          throw new Error('missing ids');
        }
        setPreview(data);
        if (blockIds.length === 0) {
          const initial =
            initialSelection && usesExclusionMode(initialSelection)
              ? selectedBlockIdsFromExclusion(data.blocks, initialSelection)
              : initialSelection?.selectedBlockIds?.length
                ? initialSelection.selectedBlockIds
                : defaultSelectedBlockIds(data.blocks);
          setSelectedIds(initial);
        }
      } catch (e) {
        setError(apiErrorText(e).message);
        setPreview(null);
      } finally {
        setLoading(false);
      }
    },
    [
      source,
      groupId,
      topicId,
      sessionId,
      documentId,
      pendingText,
      chapterTitle,
      chapterContent,
      documentExcerpt,
      initialSelection,
    ],
  );

  useEffect(() => {
    if (!visible) {
      setPreview(null);
      setSelectedIds([]);
      setError(null);
      return;
    }
    const sel = initialSelection ?? undefined;
    void fetchPreview([], sel);
  }, [visible, pendingText, source, groupId, topicId, sessionId, documentId, fetchPreview]);

  useEffect(() => {
    if (!visible || !preview || selectedIds.length === 0) return;
    const sel = exclusionFromBlocks(preview.blocks, selectedIds);
    const t = setTimeout(() => void fetchPreview(selectedIds, sel), 400);
    return () => clearTimeout(t);
  }, [selectedIds.join(',')]);

  const toggleBlock = useCallback((id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }, []);

  const selectRecent8 = useCallback(() => {
    if (!preview) return;
    const history = selectableBlocks(preview.blocks).filter(
      (b) =>
        b.kind === 'group_history' ||
        b.kind === 'history_user' ||
        b.kind === 'history_assistant',
    );
    const ids = history.slice(-8).map((b) => b.id);
    const locked = preview.blocks.filter((b) => !b.selectable).map((b) => b.id);
    setSelectedIds([...new Set([...locked, ...ids])]);
  }, [preview]);

  const selectAll = useCallback(() => {
    if (!preview) return;
    setSelectedIds(
      preview.blocks.filter((b) => b.selectable && !b.omittedByBudget).map((b) => b.id),
    );
  }, [preview]);

  const clearHistory = useCallback(() => {
    if (!preview) return;
    setSelectedIds(preview.blocks.filter((b) => !b.selectable).map((b) => b.id));
  }, [preview]);

  const apply = useCallback(() => {
    if (!preview) return;
    onApply(exclusionFromBlocks(preview.blocks, selectedIds));
    onClose();
  }, [preview, selectedIds, onApply, onClose]);

  const selectable = selectableBlocks(preview?.blocks ?? []);
  const includedCount = selectable.filter((b) => selectedIds.includes(b.id)).length;
  const excludedCount = selectable.length - includedCount;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.page}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <PixelCharacter
              character={buildDogCharacter(headerDog)}
              size={40}
              motion={PERSONALITY_MOTION[headerDog.personality]}
              animated
            />
            <Text style={styles.title}>{zh.chat.composeContextTitle}</Text>
          </View>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={styles.closeLink}>{zh.context.close}</Text>
          </Pressable>
        </View>

        {loading && !preview ? (
          <ActivityIndicator style={styles.loader} color={brainTokens.accent} />
        ) : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}

        {preview ? (
          <>
            <ContextUsageDetailContent usage={preview.usage} cardStyle={styles.usageCard} />
            {preview.usage.ratio >= 0.9 ? (
              <Text style={styles.warn}>{zh.context.tokenNearLimit}</Text>
            ) : null}

            <View style={styles.toolbar}>
              <Pressable style={styles.toolBtn} onPress={selectRecent8}>
                <Text style={styles.toolBtnText}>{zh.chat.contextRecent8}</Text>
              </Pressable>
              <Pressable style={styles.toolBtn} onPress={selectAll}>
                <Text style={styles.toolBtnText}>{zh.chat.contextSelectAll}</Text>
              </Pressable>
              <Pressable style={styles.toolBtn} onPress={clearHistory}>
                <Text style={styles.toolBtnText}>{zh.chat.contextClearHistory}</Text>
              </Pressable>
            </View>

            <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
              {preview.blocks.map((block) => (
                <ContextPreviewBlockRow
                  key={block.id}
                  block={block}
                  selected={selectedIds.includes(block.id)}
                  onToggle={() => toggleBlock(block.id)}
                />
              ))}

              <Pressable
                style={styles.promptHeader}
                onPress={() => setPromptExpanded((v) => !v)}
              >
                <Text style={styles.promptTitle}>{zh.chat.contextPromptPreview}</Text>
                <Text style={styles.chevron}>{promptExpanded ? '▾' : '▸'}</Text>
              </Pressable>
              {promptExpanded ? (
                <Text style={styles.promptBody} selectable>
                  {formatMessagesAsMarkdown(preview.messages)}
                </Text>
              ) : null}
            </ScrollView>

            <Text style={styles.autoIncludeHint}>{zh.chat.contextAutoIncludeHint}</Text>

            <View style={styles.footer}>
              <Text style={styles.footerHint}>
                {zh.chat.contextIncludedExcluded(includedCount, excludedCount)}
              </Text>
              <Pressable style={styles.applyBtn} onPress={apply}>
                <Text style={styles.applyBtnText}>{zh.chat.applyContext}</Text>
              </Pressable>
            </View>
          </>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: brainTokens.bg,
    paddingTop: 56,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexShrink: 1,
    paddingRight: 8,
  },
  title: {
    fontSize: typography.title,
    fontWeight: '700',
    color: brainTokens.text,
    flexShrink: 1,
  },
  closeLink: {
    fontSize: typography.body,
    color: brainTokens.accent,
  },
  loader: { marginTop: 40 },
  error: {
    marginHorizontal: 16,
    color: brainTokens.error,
    fontSize: typography.caption,
  },
  usageCard: {
    marginHorizontal: 16,
    marginBottom: 8,
  },
  warn: {
    marginHorizontal: 16,
    marginBottom: 8,
    fontSize: typography.caption,
    color: brainTokens.error,
  },
  autoIncludeHint: {
    marginHorizontal: 16,
    marginBottom: 8,
    fontSize: typography.caption,
    color: brainTokens.textMuted,
    lineHeight: 18,
  },
  toolbar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  toolBtn: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: brainTokens.bgElevated,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: brainTokens.border,
  },
  toolBtnText: {
    fontSize: typography.caption,
    color: brainTokens.accent,
    fontWeight: '600',
  },
  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  promptHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
    marginBottom: 8,
  },
  promptTitle: {
    fontSize: typography.body,
    fontWeight: '700',
    color: brainTokens.text,
  },
  chevron: {
    fontSize: 12,
    color: brainTokens.textMuted,
  },
  promptBody: {
    fontSize: typography.caption,
    color: brainTokens.textMuted,
    lineHeight: 20,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  footer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: brainTokens.border,
    backgroundColor: brainTokens.bgElevated,
  },
  footerHint: {
    fontSize: typography.caption,
    color: brainTokens.textMuted,
    marginBottom: 10,
    textAlign: 'center',
  },
  applyBtn: {
    backgroundColor: brainTokens.accent,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  applyBtnText: {
    color: '#fff',
    fontSize: typography.body,
    fontWeight: '700',
  },
});
