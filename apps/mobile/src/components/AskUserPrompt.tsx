import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  ActivityIndicator, StyleSheet,
} from 'react-native';

type Props = {
  runId: string;
  question: string;
  options?: string[];
  onResumed?: () => void;
  resumeRun: (runId: string, userInput: string) => Promise<void>;
};

export default function AskUserPrompt({ runId, question, options, onResumed, resumeRun }: Props) {
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(text: string) {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await resumeRun(runId, t);
      onResumed?.();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : '提交失败，请重试');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.question}>{question}</Text>
      {options && options.length > 0 ? (
        <View style={styles.chips}>
          {options.map((opt) => (
            <TouchableOpacity
              key={opt}
              style={[styles.chip, busy && styles.chipDisabled]}
              onPress={() => submit(opt)}
              disabled={busy}
            >
              <Text style={styles.chipText}>{opt}</Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : (
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            value={reply}
            onChangeText={setReply}
            placeholder="输入你的回答…"
            editable={!busy}
            multiline
            returnKeyType="send"
            onSubmitEditing={() => submit(reply)}
          />
          <TouchableOpacity
            style={[styles.sendBtn, busy && styles.sendBtnDisabled]}
            onPress={() => submit(reply)}
            disabled={busy}
          >
            {busy ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.sendText}>发送</Text>
            )}
          </TouchableOpacity>
        </View>
      )}
      {err ? <Text style={styles.errorText}>{err}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#fff8e1',
    borderLeftWidth: 3,
    borderLeftColor: '#f9a825',
    borderRadius: 6,
    padding: 12,
    marginVertical: 6,
  },
  question: { fontSize: 14, color: '#333', marginBottom: 8, fontWeight: '500' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    backgroundColor: '#e3f2fd',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#90caf9',
  },
  chipDisabled: { opacity: 0.5 },
  chipText: { fontSize: 13, color: '#1565c0' },
  inputRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-end' },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 6,
    padding: 8,
    minHeight: 36,
    fontSize: 14,
  },
  sendBtn: {
    backgroundColor: '#1976d2',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
    justifyContent: 'center',
  },
  sendBtnDisabled: { opacity: 0.5 },
  sendText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  errorText: { color: '#c62828', fontSize: 12, marginTop: 6 },
});
