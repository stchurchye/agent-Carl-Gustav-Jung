import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { GroupListItem } from '@xzz/shared';
import type { GroupStackParamList } from '../navigation/types';
import { api } from '../lib/api';
import { apiErrorText } from '../lib/apiError';
import { appAlert } from '../lib/appAlert';
import { loadWorkbenchSessionRows } from '../lib/privateChatPreview';
import {
  addStudioSearchHistory,
  clearStudioSearchHistory,
  getStudioSearchHistory,
} from '../lib/studioSearchHistory';
import { openWriting } from '../lib/openWriting';
import { WRITING_ENABLED } from '../lib/featureFlags';
import {
  buildStudioSearchIndex,
  filterStudioSearchItems,
  loadStudioSearchIndexInputs,
  type StudioSearchItem,
} from '../lib/studioSearchIndex';
import {
  searchStudioChatMessages,
  type StudioMessageSearchHit,
} from '../lib/studioMessageSearch';
import { StudioChatListRow } from '../components/StudioChatListRow';
import { StudioSearchMessageRow } from '../components/StudioSearchMessageRow';
import { colors, typography } from '../theme/colors';
import { wechatChat } from '../theme/wechatChat';
import { zh } from '../locales/zh-CN';

type Props = NativeStackScreenProps<GroupStackParamList, 'StudioSearch'>;

const RECENT_COLLAPSED = 6;
const SEARCH_DEBOUNCE_MS = 320;

export function StudioSearchScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const inputRef = useRef<TextInput>(null);
  const searchSeqRef = useRef(0);
  const [query, setQuery] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [groups, setGroups] = useState<GroupListItem[]>([]);
  const [metaIndex, setMetaIndex] = useState<StudioSearchItem[]>([]);
  const [messageHits, setMessageHits] = useState<StudioMessageSearchHit[]>([]);
  const [loadingMeta, setLoadingMeta] = useState(true);
  const [searchingMessages, setSearchingMessages] = useState(false);

  const refreshHistory = useCallback(async () => {
    setHistory(await getStudioSearchHistory());
  }, []);

  const loadMetaIndex = useCallback(async () => {
    setLoadingMeta(true);
    try {
      const [groupsRes, sessions] = await Promise.all([
        api.listGroups(),
        loadWorkbenchSessionRows(zh.studio.workbenchPreviewEmpty).catch(() => []),
      ]);
      setGroups(groupsRes.data);
      const { writingTabs } = loadStudioSearchIndexInputs();
      // 写作模式隐藏时,搜索不出文稿入口与文稿条目(避免搜索成为后门)
      setMetaIndex(
        buildStudioSearchIndex(
          groupsRes.data,
          sessions,
          WRITING_ENABLED ? writingTabs : [],
          WRITING_ENABLED
            ? { writeTextTitle: zh.studio.writeText, writeTextPreview: zh.studio.writeTextPreview }
            : undefined,
        ),
      );
    } catch (e) {
      appAlert(zh.studio.loadFailed, apiErrorText(e).message);
      setGroups([]);
      setMetaIndex([]);
    } finally {
      setLoadingMeta(false);
    }
  }, []);

  useEffect(() => {
    void refreshHistory();
    void loadMetaIndex();
    const t = setTimeout(() => inputRef.current?.focus(), 120);
    return () => clearTimeout(t);
  }, [loadMetaIndex, refreshHistory]);

  const trimmedQuery = query.trim();
  const showResults = trimmedQuery.length > 0;

  const metaResults = useMemo(
    () => filterStudioSearchItems(metaIndex, trimmedQuery),
    [metaIndex, trimmedQuery],
  );

  useEffect(() => {
    if (!showResults) {
      setMessageHits([]);
      setSearchingMessages(false);
      return;
    }

    const seq = ++searchSeqRef.current;
    setSearchingMessages(true);
    const timer = setTimeout(() => {
      void searchStudioChatMessages(trimmedQuery, groups)
        .then((hits) => {
          if (searchSeqRef.current !== seq) return;
          setMessageHits(hits);
        })
        .catch(() => {
          if (searchSeqRef.current !== seq) return;
          setMessageHits([]);
        })
        .finally(() => {
          if (searchSeqRef.current === seq) setSearchingMessages(false);
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [trimmedQuery, showResults, groups]);

  const visibleHistory = historyExpanded ? history : history.slice(0, RECENT_COLLAPSED);
  const canExpandHistory = history.length > RECENT_COLLAPSED;
  const hasAnyResult = messageHits.length > 0 || metaResults.length > 0;

  const recordQuery = useCallback(
    async (q: string) => {
      await addStudioSearchHistory(q);
      await refreshHistory();
    },
    [refreshHistory],
  );

  const openMetaItem = useCallback(
    async (item: StudioSearchItem) => {
      if (trimmedQuery) await recordQuery(trimmedQuery);
      switch (item.kind) {
        case 'group':
          navigation.navigate('GroupTopics', {
            groupId: item.groupId!,
            groupName: item.groupName ?? item.title,
          });
          break;
        case 'privateChat':
          navigation.navigate('PrivateChat', { sessionId: item.sessionId });
          break;
        case 'writing':
          void openWriting(
            navigation,
            item.documentId ? { documentId: item.documentId } : undefined,
          );
          break;
      }
    },
    [navigation, recordQuery, trimmedQuery],
  );

  const openMessageHit = useCallback(
    async (hit: StudioMessageSearchHit) => {
      if (trimmedQuery) await recordQuery(trimmedQuery);
      if (hit.kind === 'group') {
        navigation.navigate('GroupChat', {
          groupId: hit.groupId!,
          groupName: hit.groupName ?? hit.title,
          topicId: hit.topicId!,
          topicName: hit.topicTitle ?? hit.title,
          scrollToMessageId: hit.messageId,
        });
        return;
      }
      navigation.navigate('PrivateChat', {
        sessionId: hit.sessionId,
        scrollToMessageId: hit.messageId,
      });
    },
    [navigation, recordQuery, trimmedQuery],
  );

  const onSubmitQuery = useCallback(() => {
    if (trimmedQuery) void recordQuery(trimmedQuery);
  }, [recordQuery, trimmedQuery]);

  const onPickHistory = useCallback((term: string) => {
    setQuery(term);
    inputRef.current?.focus();
  }, []);

  const onClearHistory = useCallback(() => {
    Alert.alert(zh.studio.searchClearHistoryTitle, zh.studio.searchClearHistoryBody, [
      { text: zh.writing.cancel, style: 'cancel' },
      {
        text: zh.studio.searchClearHistoryConfirm,
        style: 'destructive',
        onPress: () => {
          void (async () => {
            await clearStudioSearchHistory();
            await refreshHistory();
          })();
        },
      },
    ]);
  }, [refreshHistory]);

  const kindLabel = (kind: StudioSearchItem['kind']) => {
    if (kind === 'group') return zh.studio.groupsSection;
    if (kind === 'writing') return zh.studio.writeText;
    return zh.chat.title;
  };

  return (
    <View style={[styles.page, { paddingTop: insets.top }]}>
      <View style={styles.topRow}>
        <Pressable
          onPress={() => navigation.goBack()}
          hitSlop={12}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel={zh.common.back}
        >
          <Text style={styles.backIcon}>‹</Text>
        </Pressable>
        <View style={styles.inputWrap}>
          <Text style={styles.inputIcon}>⌕</Text>
          <TextInput
            ref={inputRef}
            style={styles.input}
            value={query}
            onChangeText={setQuery}
            placeholder={zh.studio.searchInputPlaceholder}
            placeholderTextColor="#B2B2B2"
            returnKeyType="search"
            clearButtonMode="while-editing"
            autoCorrect={false}
            autoCapitalize="none"
            onSubmitEditing={onSubmitQuery}
          />
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {showResults ? (
          <>
            {searchingMessages ? (
              <View style={styles.searchingRow}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={styles.searchingText}>{zh.studio.searchMessagesLoading}</Text>
              </View>
            ) : null}

            {messageHits.length > 0 ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>{zh.studio.searchChatSection}</Text>
                {messageHits.map((hit) => (
                  <StudioSearchMessageRow
                    key={hit.id}
                    title={hit.title}
                    preview={hit.preview}
                    query={trimmedQuery}
                    timeLabel={hit.timeLabel}
                    matchCount={hit.matchCount}
                    avatarSeed={hit.id}
                    onPress={() => void openMessageHit(hit)}
                  />
                ))}
              </View>
            ) : null}

            {metaResults.length > 0 ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>{zh.studio.searchMoreSection}</Text>
                {metaResults.map((item) => (
                  <View key={item.id}>
                    <Text style={styles.resultKind}>{kindLabel(item.kind)}</Text>
                    <StudioChatListRow
                      title={item.title}
                      preview={item.subtitle || kindLabel(item.kind)}
                      avatarName={item.title}
                      avatarSeed={item.id}
                      onPress={() => void openMetaItem(item)}
                    />
                  </View>
                ))}
              </View>
            ) : null}

            {!searchingMessages && !hasAnyResult && !loadingMeta ? (
              <Text style={styles.empty}>{zh.studio.searchNoResults}</Text>
            ) : null}
          </>
        ) : history.length > 0 ? (
          <View style={styles.historyBlock}>
            <View style={styles.historyHeader}>
              <Text style={styles.historyTitle}>{zh.studio.searchRecentTitle}</Text>
              <View style={styles.historyActions}>
                {canExpandHistory ? (
                  <Pressable
                    onPress={() => setHistoryExpanded((v) => !v)}
                    hitSlop={8}
                    accessibilityRole="button"
                  >
                    <Text style={styles.historyActionText}>
                      {historyExpanded ? zh.studio.searchCollapse : zh.studio.searchExpand}
                      {historyExpanded ? ' ∧' : ' ∨'}
                    </Text>
                  </Pressable>
                ) : null}
                {canExpandHistory ? <Text style={styles.historyDivider}>|</Text> : null}
                <Pressable onPress={onClearHistory} hitSlop={8} accessibilityRole="button">
                  <Text style={styles.historyTrash}>🗑</Text>
                </Pressable>
              </View>
            </View>
            <View style={styles.historyGrid}>
              {visibleHistory.map((term) => (
                <Pressable
                  key={term}
                  style={styles.historyChip}
                  onPress={() => onPickHistory(term)}
                >
                  <Text style={styles.historyClock}>◷</Text>
                  <Text style={styles.historyChipText} numberOfLines={1}>
                    {term}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : loadingMeta ? (
          <ActivityIndicator style={styles.loader} color={colors.primary} />
        ) : (
          <Text style={styles.empty}>{zh.studio.searchEmptyHistory}</Text>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: wechatChat.pageBg,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingBottom: 8,
    backgroundColor: wechatChat.navBg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: wechatChat.navBorder,
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backIcon: {
    fontSize: 32,
    lineHeight: 34,
    fontWeight: '300',
    color: '#000',
  },
  inputWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    height: 36,
    marginRight: 8,
    borderRadius: 8,
    backgroundColor: wechatChat.searchBg,
    paddingHorizontal: 10,
    gap: 6,
  },
  inputIcon: {
    fontSize: 18,
    color: colors.textTertiary,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: colors.text,
    paddingVertical: 0,
  },
  loader: { marginTop: 24 },
  scroll: { flex: 1 },
  scrollContent: {
    paddingBottom: 24,
    flexGrow: 1,
  },
  searchingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
  },
  searchingText: {
    fontSize: typography.caption,
    color: colors.textMuted,
  },
  section: {
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: typography.small,
    color: colors.textMuted,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 6,
    fontWeight: '600',
  },
  historyBlock: {
    paddingTop: 12,
    paddingHorizontal: 12,
  },
  historyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  historyTitle: {
    fontSize: typography.small,
    color: colors.textMuted,
  },
  historyActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  historyActionText: {
    fontSize: typography.small,
    color: colors.textMuted,
  },
  historyDivider: {
    fontSize: typography.small,
    color: colors.border,
  },
  historyTrash: {
    fontSize: 16,
    color: colors.textMuted,
  },
  historyGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  historyChip: {
    width: '50%',
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingRight: 8,
    gap: 6,
  },
  historyClock: {
    fontSize: 14,
    color: colors.textTertiary,
  },
  historyChipText: {
    flex: 1,
    fontSize: typography.body,
    color: colors.text,
  },
  resultKind: {
    fontSize: typography.small,
    color: colors.textMuted,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 2,
    fontWeight: '600',
  },
  empty: {
    textAlign: 'center',
    color: colors.textMuted,
    fontSize: typography.body,
    paddingHorizontal: 24,
    paddingTop: 32,
  },
});
