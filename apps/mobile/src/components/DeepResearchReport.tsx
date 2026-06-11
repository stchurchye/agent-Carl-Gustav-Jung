import React, { useState } from 'react';
import { colors } from '../theme/colors';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';

// Graceful fallback if react-native-markdown-display is not installed.
let Markdown: React.ComponentType<{ children: string }>;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  Markdown = require('react-native-markdown-display').default;
} catch {
  Markdown = ({ children }: { children: string }) => (
    <Text style={{ fontSize: 13, color: colors.text }}>{children}</Text>
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
  container: { backgroundColor: colors.fill, borderRadius: 8, marginVertical: 6, overflow: 'hidden' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    padding: 12,
  },
  title: { flex: 1, fontSize: 14, fontWeight: '600', color: colors.text, marginRight: 8 },
  meta: { fontSize: 12, color: colors.textMuted, paddingTop: 2 },
  body: { backgroundColor: colors.surface, maxHeight: 420, padding: 12 },
  citationsBox: { marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.border },
  citationsTitle: { fontSize: 12, fontWeight: '600', color: colors.textMuted, marginBottom: 4 },
  citation: { fontSize: 12, color: colors.textMuted, marginVertical: 2 },
});
