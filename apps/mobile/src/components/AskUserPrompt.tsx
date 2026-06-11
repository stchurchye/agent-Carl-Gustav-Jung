import React, { useState } from 'react';
import { colors } from '../theme/colors';
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
    backgroundColor: colors.warningBg,
    borderLeftWidth: 3,
    borderLeftColor: colors.warning,
    borderRadius: 6,
    padding: 12,
    marginVertical: 6,
  },
  question: { fontSize: 14, color: colors.text, marginBottom: 8, fontWeight: '500' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    backgroundColor: colors.infoBg,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.info,
  },
  chipDisabled: { opacity: 0.5 },
  chipText: { fontSize: 13, color: colors.info },
  inputRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-end' },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
    padding: 8,
    minHeight: 36,
    fontSize: 14,
  },
  sendBtn: {
    backgroundColor: colors.link,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
    justifyContent: 'center',
  },
  sendBtnDisabled: { opacity: 0.5 },
  sendText: { color: colors.onPrimary, fontWeight: '600', fontSize: 14 },
  errorText: { color: colors.danger, fontSize: 12, marginTop: 6 },
});
