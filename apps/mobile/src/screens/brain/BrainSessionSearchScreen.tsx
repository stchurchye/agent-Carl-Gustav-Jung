import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MemorySessionSearchHit } from '@xzz/shared';
import { formatZhDateTime, labelSearchChannel } from '../../brain/brainLabels';
import { brainLogicHints } from '../../brain/logicHints';
import { BrainScreenShell } from '../../components/brain/BrainScreenShell';
import { api } from '../../lib/api';
import { zh } from '../../locales/zh-CN';
import type { BrainStackParamList } from '../../navigation/types';
import { brainTokens } from '../../theme/brainTokens';

type Props = NativeStackScreenProps<BrainStackParamList, 'BrainSessionSearch'>;

export function BrainSessionSearchScreen(_props: Props) {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<MemorySessionSearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const search = useCallback(async () => {
    const q = query.trim();
    if (q.length < 2) return;
    setLoading(true);
    setSearched(true);
    try {
      const res = await api.searchSessionMessages({ q, limit: 30 });
      setItems(res.data);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [query]);

  return (
    <BrainScreenShell
      title={zh.brain.sections.memorySearch}
      hint={brainLogicHints.memorySearch}
      onBack={() => _props.navigation.goBack()}
      loading={loading}
    >
      <View style={styles.searchRow}>
        <TextInput
          style={styles.input}
          value={query}
          onChangeText={setQuery}
          placeholder={zh.brain.states.searchPlaceholder}
          placeholderTextColor={brainTokens.textDim}
          returnKeyType="search"
          onSubmitEditing={() => void search()}
        />
        <Pressable style={styles.searchBtn} onPress={() => void search()} accessibilityRole="button">
          <Text style={styles.searchBtnText}>{zh.brain.actions.search}</Text>
        </Pressable>
      </View>

      {searched && items.length === 0 ? (
        <Text style={styles.empty}>{zh.brain.states.empty}</Text>
      ) : (
        items.map((hit) => (
          <View key={hit.messageId} style={styles.hitCard}>
            <Text style={styles.hitMeta}>
              {labelSearchChannel(hit.channel)} · {formatZhDateTime(hit.createdAt)}
            </Text>
            <Text style={styles.hitBody} numberOfLines={5}>
              {hit.contentPreview}
            </Text>
          </View>
        ))
      )}
    </BrainScreenShell>
  );
}

const styles = StyleSheet.create({
  searchRow: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    marginBottom: 12,
    gap: 8,
  },
  input: {
    flex: 1,
    backgroundColor: brainTokens.bgCard,
    borderWidth: 1,
    borderColor: brainTokens.borderSubtle,
    borderRadius: 4,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: brainTokens.text,
    fontSize: 15,
  },
  searchBtn: {
    justifyContent: 'center',
    paddingHorizontal: 14,
    backgroundColor: brainTokens.accentDim,
    borderRadius: 4,
  },
  searchBtnText: {
    color: brainTokens.text,
    fontWeight: '600',
  },
  empty: {
    color: brainTokens.textMuted,
    textAlign: 'center',
    marginTop: 24,
  },
  hitCard: {
    marginHorizontal: 12,
    marginBottom: 8,
    padding: 12,
    backgroundColor: brainTokens.bgCard,
    borderRadius: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: brainTokens.border,
  },
  hitMeta: {
    fontSize: 11,
    color: brainTokens.accent,
    marginBottom: 6,
  },
  hitBody: {
    fontSize: 13,
    color: brainTokens.textMuted,
    lineHeight: 18,
  },
});
