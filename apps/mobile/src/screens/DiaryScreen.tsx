import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { DiaryStatus } from '@xzz/shared';
import type { GroupStackParamList } from '../navigation/types';
import { WeChatChatHeader } from '../components/WeChatChatHeader';
import { useDiaryEntry } from '../features/diary/useDiaryEntry';
import { localDayKey } from '../lib/diaryDay';
import { wechatChatStyles } from '../theme/wechatChat';
import { brainTokens } from '../theme/brainTokens';
import { zh } from '../locales/zh-CN';

type Props = NativeStackScreenProps<GroupStackParamList, 'Diary'>;

function statusLabel(status: DiaryStatus): string {
  if (status === 'distilled') return zh.diary.statusDistilled;
  if (status === 'confirmed') return zh.diary.statusConfirmed;
  return zh.diary.statusDraft;
}

/** 单日日记屏:看今天(或指定 day)的日记,没有则生成,可跟 bow wow 聊着改、确认收进记忆。 */
export function DiaryScreen({ route }: Props) {
  const insets = useSafeAreaInsets();
  const { scope, scopeId, scopeName, dayKey: dayKeyParam } = route.params;
  const dayKey = dayKeyParam ?? localDayKey();
  const { entry, loading, loadError, busy, error, reload, clearError, generate, refine, confirm } =
    useDiaryEntry(scope, scopeId, dayKey);
  const [draft, setDraft] = useState('');

  const title = scope === 'group' && scopeName ? zh.diary.groupTitle(scopeName) : zh.diary.title;

  return (
    <View style={wechatChatStyles.page}>
      <WeChatChatHeader title={title} showBack />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}>
        {loading ? (
          <ActivityIndicator style={styles.loader} color={brainTokens.accent} />
        ) : loadError ? (
          <View style={styles.emptyWrap}>
            <Text style={styles.emptyText}>{zh.diary.loadFailed}</Text>
            <Pressable
              testID="diary-retry"
              onPress={() => reload()}
              style={({ pressed }) => [styles.primaryBtn, pressed && styles.btnDim]}
              accessibilityRole="button"
            >
              <Text style={styles.primaryBtnText}>{zh.diary.retry}</Text>
            </Pressable>
          </View>
        ) : !entry ? (
          <View style={styles.emptyWrap}>
            <Text style={styles.emptyText}>{zh.diary.empty}</Text>
            <Pressable
              testID="diary-generate"
              onPress={() => void generate()}
              disabled={busy}
              style={({ pressed }) => [styles.primaryBtn, (pressed || busy) && styles.btnDim]}
              accessibilityRole="button"
            >
              <Text style={styles.primaryBtnText}>
                {busy ? zh.diary.generating : zh.diary.generate}
              </Text>
            </Pressable>
          </View>
        ) : (
          <View>
            <Text style={styles.meta}>
              {statusLabel(entry.status)} · {dayKey}
            </Text>
            <Text style={styles.summary}>{entry.summary.trim() || zh.diary.quiet}</Text>

            <View style={styles.refineWrap}>
              <TextInput
                testID="diary-refine-input"
                value={draft}
                onChangeText={(t) => {
                  setDraft(t);
                  if (error) clearError();
                }}
                placeholder={zh.diary.refinePlaceholder}
                placeholderTextColor={brainTokens.textDim}
                style={styles.refineInput}
                multiline
                editable={!busy}
              />
              <Pressable
                testID="diary-refine"
                onPress={() => {
                  // 仅成功才清空输入:失败时保留用户写的意见,免得重打
                  void refine(draft).then((okRefine) => {
                    if (okRefine) setDraft('');
                  });
                }}
                disabled={busy || !draft.trim()}
                style={({ pressed }) => [
                  styles.refineBtn,
                  (pressed || busy || !draft.trim()) && styles.btnDim,
                ]}
                accessibilityRole="button"
              >
                <Text style={styles.refineBtnText}>{busy ? zh.diary.refining : zh.diary.refine}</Text>
              </Pressable>
            </View>

            {entry.status !== 'distilled' ? (
              <Pressable
                testID="diary-confirm"
                onPress={() => void confirm()}
                disabled={busy}
                style={({ pressed }) => [styles.primaryBtn, (pressed || busy) && styles.btnDim]}
                accessibilityRole="button"
              >
                <Text style={styles.primaryBtnText}>
                  {busy ? zh.diary.confirming : zh.diary.confirm}
                </Text>
              </Pressable>
            ) : null}
          </View>
        )}

        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12 },
  loader: { marginTop: 48 },
  emptyWrap: { alignItems: 'center', gap: 16, marginTop: 48 },
  emptyText: { fontSize: 15, color: brainTokens.textMuted },
  meta: { fontSize: 12, color: brainTokens.textDim, marginBottom: 8 },
  summary: {
    fontSize: 16,
    lineHeight: 26,
    color: brainTokens.text,
    backgroundColor: brainTokens.bgElevated,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: brainTokens.border,
    padding: 14,
  },
  refineWrap: { marginTop: 16, gap: 8 },
  refineInput: {
    minHeight: 44,
    maxHeight: 120,
    fontSize: 15,
    color: brainTokens.text,
    backgroundColor: brainTokens.bg,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: brainTokens.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  refineBtn: {
    alignSelf: 'flex-end',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: brainTokens.accent,
  },
  refineBtnText: { fontSize: 14, color: brainTokens.accent, fontWeight: '500' },
  primaryBtn: {
    marginTop: 20,
    backgroundColor: brainTokens.accent,
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center',
  },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  btnDim: { opacity: 0.5 },
  error: { marginTop: 16, color: '#C0392B', fontSize: 13, textAlign: 'center' },
});
