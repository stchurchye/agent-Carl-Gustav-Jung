import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AgentRunCard } from '../../features/agent/AgentRunCard';
import type { BrainStackParamList } from '../../navigation/types';
import { brainTokens } from '../../theme/brainTokens';

type Props = NativeStackScreenProps<BrainStackParamList, 'BrainAgentTaskDetail'>;

export function BrainAgentTaskDetailScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const { runId } = route.params;

  return (
    <View style={[styles.page, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.back}>← 返回任务列表</Text>
        </TouchableOpacity>
        <Text style={styles.title}>任务详情</Text>
        <View style={{ width: 80 }} />
      </View>
      <ScrollView contentContainerStyle={{ padding: 12 }}>
        <AgentRunCard
          runId={runId}
          onRetry={(newId) =>
            // M1e task 7：push（不是 replace），保留旧任务在 back stack，
            // 用户能回去对比新旧任务的不同结果。
            navigation.push('BrainAgentTaskDetail', { runId: newId })
          }
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: brainTokens.bg },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  back: { color: brainTokens.accent, fontSize: 14 },
  title: { color: brainTokens.text, fontSize: 18, fontWeight: '600' },
});
