import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { BrainStackParamList } from '../navigation/types';
import { AgentRunCard } from '../features/agent/AgentRunCard';

type DetailRoute = RouteProp<BrainStackParamList, 'BrainAgentTaskDetail'>;

export function AgentRunDetailScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<DetailRoute>();
  const insets = useSafeAreaInsets();
  const { runId } = route.params;

  return (
    <View style={[styles.page, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.back}>← 返回</Text>
        </TouchableOpacity>
        <Text style={styles.title}>任务详情</Text>
        <View style={{ width: 60 }} />
      </View>
      <ScrollView contentContainerStyle={{ padding: 12 }}>
        <AgentRunCard
          runId={runId}
          onRetry={(newId) => navigation.push('BrainAgentTaskDetail', { runId: newId })}
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#fff' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#eee',
  },
  back: { color: '#06b', fontSize: 14 },
  title: { fontSize: 16, fontWeight: '600', color: '#222' },
});
