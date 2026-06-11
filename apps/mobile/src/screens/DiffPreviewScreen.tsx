import { useEffect, useState } from 'react';
import { computeDiff } from '@xzz/shared';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { appAlert } from '../lib/appAlert';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppTextInput } from '../components/AppTextInput';
import { DiffView } from '../components/DiffView';
import { PrimaryButton } from '../components/PrimaryButton';
import { TabletFrame } from '../components/TabletFrame';
import { colors, typography } from '../theme/colors';
import { useLayout } from '../theme/layout';
import { zh } from '../locales/zh-CN';
import type { GroupStackParamList } from '../navigation/types';
import { api } from '../lib/api';
import { openWriting } from '../lib/openWriting';
import { apiErrorText } from '../lib/apiError';
import { clientLog } from '../lib/clientLog';

type Props = NativeStackScreenProps<GroupStackParamList, 'DiffPreview'>;

export function DiffPreviewScreen({ route, navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { isTablet, bodyFontSize, bodyLineHeight, buttonFontSize } = useLayout();
  const {
    documentId,
    revisionId,
    blockId,
    oldText,
    newText,
    comment,
    retryAction = '润色',
    retryInstruction = '',
    feedbackHistory = [],
    viewOnly = false,
  } = route.params;
  const [editedText, setEditedText] = useState(newText);
  const [retryInput, setRetryInput] = useState('');
  const [retryPanelOpen, setRetryPanelOpen] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const segments = computeDiff(oldText, editedText);
  const busy = retrying || accepting;

  const pageTitle = comment?.trim() || zh.diff.title;
  /** 增删对比、建议正文：同一套正文字号 */
  const contentFontSize = bodyFontSize;
  const contentLineHeight = bodyLineHeight;
  /** 两个模块标题（增删对比 / 建议正文） */
  const panelLabelSize = buttonFontSize;
  const panelLabelLineHeight = Math.round(buttonFontSize * 1.45);
  /** 页顶题目 */
  const pageTitleSize = isTablet ? 42 : 38;
  const pageTitleLineHeight = isTablet ? 58 : 52;

  useEffect(() => {
    setEditedText(newText);
  }, [revisionId, newText]);

  const goWriting = () => void openWriting(navigation, { documentId, blockId, allowDisabled: true }); // 写作功能内部二跳

  const showRevisionError = (e: unknown) => {
    const { message, hint } = apiErrorText(e);
    appAlert(message, hint, [{ text: zh.common.confirm, onPress: goWriting }]);
  };

  const handleAccept = async () => {
    const finalText = editedText.trim();
    if (!finalText) {
      appAlert(zh.diff.editEmptyTitle, zh.diff.editEmptyHint);
      return;
    }
    clientLog('revision.accept', {
      documentId,
      revisionId,
      manuallyEdited: finalText !== newText,
    });
    setAccepting(true);
    try {
      await api.acceptRevision(documentId, revisionId, finalText);
      void openWriting(navigation, {
        documentId,
        blockId,
        toast: '已经放进文章里了，您写得真好',
        allowDisabled: true, // 写作功能内部二跳
      });
    } catch (e) {
      showRevisionError(e);
    } finally {
      setAccepting(false);
    }
  };

  const handleReject = async () => {
    if (viewOnly) {
      navigation.goBack();
      return;
    }
    clientLog('revision.reject', { documentId, revisionId });
    try {
      await api.rejectRevision(documentId, revisionId);
      navigation.goBack();
    } catch (e) {
      showRevisionError(e);
    }
  };

  const handleRetry = async () => {
    const feedback = retryInput.trim();
    if (!blockId) {
      appAlert(zh.writing.retryNoBlock, undefined, [
        { text: zh.common.confirm, onPress: goWriting },
      ]);
      return;
    }
    if (!feedback) {
      appAlert(zh.writing.retryEmptyTitle, zh.writing.retryEmptyHint);
      return;
    }

    clientLog('revision.retry', { documentId, revisionId, action: retryAction });
    setRetrying(true);
    try {
      await api.rejectRevision(documentId, revisionId);
      const res = await api.aiSuggest(documentId, blockId, retryAction, {
        retry: {
          baseInstruction: retryInstruction,
          previousSuggestion: editedText,
          additionalFeedback: feedback,
          priorFeedback: feedbackHistory,
        },
      });
      navigation.replace('DiffPreview', {
        documentId,
        revisionId: res.data.revision.id,
        blockId,
        oldText: res.data.oldText,
        newText: res.data.newText,
        comment: res.data.comment,
        createdAt: res.data.revision.createdAt,
        retryAction,
        retryInstruction,
        feedbackHistory: [...feedbackHistory, feedback],
      });
      setRetryInput('');
      setRetryPanelOpen(false);
    } catch (e) {
      showRevisionError(e);
    } finally {
      setRetrying(false);
    }
  };

  const closeRetryPanel = () => {
    if (retrying) return;
    setRetryPanelOpen(false);
    setRetryInput('');
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={insets.top}
    >
      <TabletFrame variant={isTablet ? 'page' : 'content'} style={styles.flex}>
        <View
          style={[
            styles.page,
            { paddingTop: Math.max(insets.top, 12) + 4 },
          ]}
        >
          <Text
            style={[
              styles.pageTitle,
              { fontSize: pageTitleSize, lineHeight: pageTitleLineHeight },
            ]}
          >
            {pageTitle}
          </Text>

          <View style={styles.main}>
            <View style={styles.panel}>
              <Text
                style={[
                  styles.panelLabel,
                  { fontSize: panelLabelSize, lineHeight: panelLabelLineHeight },
                ]}
              >
                {zh.diff.diffPanelLabel}
              </Text>
              <ScrollView
                style={styles.panelScroll}
                contentContainerStyle={styles.panelScrollContent}
                showsVerticalScrollIndicator
                keyboardShouldPersistTaps="handled"
                nestedScrollEnabled
              >
                <DiffView
                  segments={segments}
                  hideComment
                  embedded
                  bodyFontSize={contentFontSize}
                  bodyLineHeight={contentLineHeight}
                />
              </ScrollView>
            </View>

            <View style={styles.panel}>
              <Text
                style={[
                  styles.panelLabel,
                  { fontSize: panelLabelSize, lineHeight: panelLabelLineHeight },
                ]}
              >
                {zh.diff.editPanelLabel}
              </Text>
              <ScrollView
                style={styles.panelScroll}
                contentContainerStyle={styles.panelScrollContent}
                keyboardShouldPersistTaps="handled"
                nestedScrollEnabled
                showsVerticalScrollIndicator
              >
                <AppTextInput
                  style={[
                    styles.editInput,
                    { fontSize: contentFontSize, lineHeight: contentLineHeight },
                  ]}
                  placeholder={zh.diff.editSuggestionPlaceholder}
                  placeholderTextColor={colors.textMuted}
                  value={editedText}
                  onChangeText={setEditedText}
                  multiline
                  scrollEnabled
                  textAlignVertical="top"
                  editable={!busy && !viewOnly}
                />
              </ScrollView>
            </View>
          </View>

          {viewOnly ? (
            <Text style={[styles.viewOnlyHint, { fontSize: contentFontSize, lineHeight: contentLineHeight }]}>
              {zh.writing.viewOnlyHint}
            </Text>
          ) : null}

          <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12) + 8 }]}>
            {viewOnly ? (
              <PrimaryButton title={zh.writing.backFromDiff} onPress={() => navigation.goBack()} />
            ) : (
              <>
            <View style={styles.actionsRow}>
              <PrimaryButton
                title={zh.writing.reject}
                onPress={handleReject}
                variant="secondary"
                style={styles.actionSide}
                disabled={busy}
              />
              <PrimaryButton
                title={zh.writing.apply}
                onPress={() => void handleAccept()}
                style={styles.actionSide}
                disabled={busy}
              />
            </View>

            {retryPanelOpen ? (
              <View style={styles.retryPanel}>
                <AppTextInput
                  style={[
                    styles.retryInput,
                    { fontSize: contentFontSize, lineHeight: contentLineHeight },
                  ]}
                  placeholder={zh.writing.retryPlaceholder}
                  placeholderTextColor={colors.textMuted}
                  value={retryInput}
                  onChangeText={setRetryInput}
                  multiline
                  scrollEnabled
                  textAlignVertical="top"
                  editable={!busy}
                  autoFocus
                />
                {retrying ? (
                  <View style={styles.statusRow}>
                    <ActivityIndicator color={colors.primary} />
                    <Text style={styles.statusText}>{zh.writing.retrying}</Text>
                  </View>
                ) : (
                  <View style={styles.retryActions}>
                    <PrimaryButton
                      title={zh.writing.retrySubmit}
                      onPress={() => void handleRetry()}
                      disabled={busy}
                      style={styles.retrySubmitBtn}
                    />
                    <Pressable onPress={closeRetryPanel} hitSlop={8} disabled={busy}>
                      <Text style={styles.retryCancel}>{zh.writing.cancel}</Text>
                    </Pressable>
                  </View>
                )}
              </View>
            ) : (
              <PrimaryButton
                title={zh.writing.retry}
                onPress={() => setRetryPanelOpen(true)}
                variant="ghost"
                disabled={busy}
              />
            )}

            {accepting ? (
              <View style={styles.statusRow}>
                <ActivityIndicator color={colors.primary} />
                <Text style={styles.statusText}>{zh.common.loading}</Text>
              </View>
            ) : null}
              </>
            )}
          </View>
        </View>
      </TabletFrame>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  page: {
    flex: 1,
    minHeight: 0,
  },
  pageTitle: {
    fontWeight: '700',
    color: colors.text,
    marginBottom: 14,
    flexShrink: 0,
    paddingHorizontal: 2,
  },
  main: {
    flex: 1,
    minHeight: 0,
    gap: 12,
    marginBottom: 12,
  },
  viewOnlyHint: {
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: 10,
    paddingHorizontal: 8,
  },
  panel: {
    flex: 1,
    minHeight: 0,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  panelLabel: {
    fontWeight: '700',
    color: colors.text,
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 10,
    flexShrink: 0,
  },
  panelScroll: {
    flex: 1,
    minHeight: 0,
  },
  panelScrollContent: {
    paddingHorizontal: 14,
    paddingBottom: 14,
    flexGrow: 1,
  },
  editInput: {
    flexGrow: 1,
    minHeight: 120,
    padding: 0,
    color: colors.text,
    backgroundColor: 'transparent',
  },
  footer: {
    flexShrink: 0,
    gap: 12,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  retryPanel: {
    gap: 10,
  },
  retryInput: {
    minHeight: 72,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: 14,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  retryActions: { gap: 8, alignItems: 'center' },
  retrySubmitBtn: { alignSelf: 'stretch' },
  retryCancel: {
    fontSize: typography.caption,
    color: colors.textMuted,
    paddingVertical: 6,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  statusText: { fontSize: typography.caption, color: colors.textMuted },
  actionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  actionSide: { flex: 1 },
});
