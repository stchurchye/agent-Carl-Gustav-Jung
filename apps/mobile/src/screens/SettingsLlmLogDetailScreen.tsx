import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import type { LlmRequestLogDetail } from '@xzz/shared';
import { formatTokenCount } from '@xzz/shared';
import { WeChatChatHeader } from '../components/WeChatChatHeader';
import { WeChatGroupedSection } from '../components/wechat/WeChatGroupedSection';
import { api } from '../lib/api';
import { zenmuxChatModelLabel } from '../lib/chatLlmModel';
import type { GroupStackParamList } from '../navigation/types';
import { colors } from '../theme/colors';
import { wechat } from '../theme/wechat';
import { wechatChatStyles } from '../theme/wechatChat';
import { zh } from '../locales/zh-CN';

type Props = NativeStackScreenProps<GroupStackParamList, 'SettingsLlmLogDetail'>;
type ViewMode = 'readable' | 'raw';

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metaRow}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={styles.metaValue}>{value}</Text>
    </View>
  );
}

export function SettingsLlmLogDetailScreen({ route }: Props) {
  const insets = useSafeAreaInsets();
  const { id } = route.params;
  const [detail, setDetail] = useState<LlmRequestLogDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<ViewMode>('readable');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getLlmLog(id);
      setDetail(res.data);
    } catch {
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const copyRaw = async () => {
    if (!detail?.rawJson) return;
    await Clipboard.setStringAsync(detail.rawJson);
  };

  const contextPct =
    detail?.contextRatio != null
      ? `${Math.round(detail.contextRatio * 100)}%`
      : undefined;

  return (
    <View style={wechatChatStyles.page}>
      <WeChatChatHeader title={zh.me.llmLogDetailTitle} showBack />
      {loading ? (
        <ActivityIndicator color={colors.primary} style={styles.loader} />
      ) : !detail ? (
        <Text style={styles.empty}>{zh.me.llmLogNotFound}</Text>
      ) : (
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            { paddingBottom: Math.max(insets.bottom, 16) + 24 },
          ]}
        >
          <WeChatGroupedSection title={zh.me.llmLogOverview}>
            <View style={styles.cardInner}>
              <MetaRow label={zh.me.llmLogChannel} value={detail.channelLabel} />
              <MetaRow
                label={zh.me.llmLogModel}
                value={zenmuxChatModelLabel(detail.model)}
              />
              <MetaRow
                label={zh.me.llmLogProvider}
                value={detail.provider === 'zenmux' ? 'ZenMux' : 'DeepSeek'}
              />
              <MetaRow label={zh.me.llmLogStatus} value={detail.metaLine} />
              {contextPct ? (
                <MetaRow label={zh.me.llmLogContext} value={contextPct} />
              ) : null}
              {detail.usage?.totalTokens ? (
                <MetaRow
                  label={zh.me.llmLogTokens}
                  value={`${formatTokenCount(detail.usage.totalTokens)}${
                    detail.usage.promptTokens != null
                      ? `（入 ${formatTokenCount(detail.usage.promptTokens)} / 出 ${formatTokenCount(detail.usage.completionTokens ?? 0)}）`
                      : ''
                  }`}
                />
              ) : null}
              {detail.errorMessage ? (
                <MetaRow label={zh.me.llmLogError} value={detail.errorMessage} />
              ) : null}
            </View>
          </WeChatGroupedSection>

          <View style={styles.modeBar}>
            <Pressable
              style={[styles.modeBtn, mode === 'readable' && styles.modeBtnActive]}
              onPress={() => setMode('readable')}
            >
              <Text
                style={[styles.modeBtnText, mode === 'readable' && styles.modeBtnTextActive]}
              >
                {zh.me.llmLogReadable}
              </Text>
            </Pressable>
            <Pressable
              style={[styles.modeBtn, mode === 'raw' && styles.modeBtnActive]}
              onPress={() => setMode('raw')}
            >
              <Text style={[styles.modeBtnText, mode === 'raw' && styles.modeBtnTextActive]}>
                {zh.me.llmLogRaw}
              </Text>
            </Pressable>
          </View>

          {mode === 'readable' ? (
            <>
              <WeChatGroupedSection title={zh.me.llmLogRequest}>
                {detail.displayTurns.map((turn, i) => {
                  const full = detail.messages[i]?.content ?? turn.preview;
                  const body = turn.collapsed ? turn.preview : full;
                  return (
                    <View
                      key={`${turn.role}-${i}`}
                      style={[
                        styles.turn,
                        i < detail.displayTurns.length - 1 && styles.turnBorder,
                      ]}
                    >
                      <Text style={styles.turnLabel}>
                        {turn.label}
                        {turn.collapsed
                          ? ` · ${turn.charCount} 字（系统提示已折叠）`
                          : ` · ${turn.charCount} 字`}
                      </Text>
                      <Text style={styles.turnBody}>{body}</Text>
                    </View>
                  );
                })}
              </WeChatGroupedSection>
              {detail.responseDisplay ? (
                <WeChatGroupedSection title={zh.me.llmLogResponse}>
                  <View style={styles.responseBox}>
                    <Text style={styles.responseText}>{detail.responseDisplay}</Text>
                  </View>
                </WeChatGroupedSection>
              ) : null}
            </>
          ) : (
            <WeChatGroupedSection
              title={zh.me.llmLogRaw}
              footer={zh.me.llmLogRawHint}
            >
              <Pressable onPress={() => void copyRaw()} style={styles.copyRow}>
                <Text style={styles.copyText}>{zh.me.llmLogCopyRaw}</Text>
              </Pressable>
              <View style={styles.rawBox}>
                <Text style={styles.rawText} selectable>
                  {detail.rawJson}
                </Text>
              </View>
            </WeChatGroupedSection>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingTop: 8 },
  loader: { marginVertical: 40 },
  empty: {
    textAlign: 'center',
    color: wechat.textSecondary,
    marginTop: 48,
    fontSize: 14,
  },
  cardInner: {
    paddingHorizontal: 16,
    paddingVertical: 4,
    backgroundColor: wechat.cellBg,
  },
  metaRow: {
    flexDirection: 'row',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: wechat.separator,
  },
  metaLabel: {
    width: 72,
    fontSize: 14,
    color: wechat.textSecondary,
  },
  metaValue: {
    flex: 1,
    fontSize: 14,
    color: wechat.textPrimary,
    lineHeight: 20,
  },
  modeBar: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginVertical: 12,
    backgroundColor: '#EDEDED',
    borderRadius: 8,
    padding: 3,
  },
  modeBtn: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 6,
  },
  modeBtnActive: {
    backgroundColor: '#fff',
  },
  modeBtnText: {
    fontSize: 14,
    color: wechat.textSecondary,
  },
  modeBtnTextActive: {
    color: wechat.textPrimary,
    fontWeight: '600',
  },
  turn: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: wechat.cellBg,
  },
  turnBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: wechat.separator,
  },
  turnLabel: {
    fontSize: 12,
    color: wechat.textSecondary,
    marginBottom: 6,
  },
  turnBody: {
    fontSize: 15,
    color: wechat.textPrimary,
    lineHeight: 22,
  },
  responseBox: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: wechat.cellBg,
  },
  responseText: {
    fontSize: 15,
    color: wechat.textPrimary,
    lineHeight: 22,
  },
  copyRow: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: wechat.cellBg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: wechat.separator,
  },
  copyText: {
    fontSize: 15,
    color: colors.primary,
    textAlign: 'center',
  },
  rawBox: {
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: wechat.cellBg,
  },
  rawText: {
    fontFamily: 'Menlo',
    fontSize: 11,
    lineHeight: 16,
    color: wechat.textPrimary,
  },
});
