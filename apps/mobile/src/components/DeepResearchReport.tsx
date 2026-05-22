import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';

// Graceful fallback if react-native-markdown-display is not installed.
let Markdown: React.ComponentType<{ children: string }>;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  Markdown = require('react-native-markdown-display').default;
} catch {
  Markdown = ({ children }: { children: string }) => (
    <Text style={{ fontSize: 13, color: '#333' }}>{children}</Text>
  );
}

type Citation = { kind: string; id: string; label?: string };

type Props = {
  question: string;
  report: string;
  citations?: Citation[];
  stepsUsed: number;
};

export default function DeepResearchReport({ question, report, citations, stepsUsed }: Props) {
  const [expanded, setExpanded] = useState(false);

  return (
    <View style={styles.container}>
      <TouchableOpacity onPress={() => setExpanded((v) => !v)} style={styles.header}>
        <Text style={styles.title} numberOfLines={2}>
          📚 深度调研：{question}
        </Text>
        <Text style={styles.meta}>
          {stepsUsed} 步 {expanded ? '▼' : '▶'}
        </Text>
      </TouchableOpacity>

      {expanded && (
        <ScrollView style={styles.body} nestedScrollEnabled>
          <Markdown>{report}</Markdown>

          {citations && citations.length > 0 && (
            <View style={styles.citationsBox}>
              <Text style={styles.citationsTitle}>引用（{citations.length}）</Text>
              {citations.map((c, i) => (
                <Text key={i} style={styles.citation}>
                  · {c.label ?? c.id}
                </Text>
              ))}
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: '#f3f4f6', borderRadius: 8, marginVertical: 6, overflow: 'hidden' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    padding: 12,
  },
  title: { flex: 1, fontSize: 14, fontWeight: '600', color: '#1f2937', marginRight: 8 },
  meta: { fontSize: 12, color: '#6b7280', paddingTop: 2 },
  body: { backgroundColor: '#fff', maxHeight: 420, padding: 12 },
  citationsBox: { marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#e5e7eb' },
  citationsTitle: { fontSize: 12, fontWeight: '600', color: '#6b7280', marginBottom: 4 },
  citation: { fontSize: 12, color: '#374151', marginVertical: 2 },
});
