import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useHoldToSpeak } from '../../../hooks/useHoldToSpeak';
import { api } from '../../../lib/api';
import { zh } from '../../../locales/zh-CN';
import type { SayLine } from './story';

const G = zh.games.drama;

type Verdict = { pass: boolean; reply: string; score: number; hint?: string };

/** 说对台词:打字 + 按住念台词 → 判官判定 → 入戏回应 + 过/不过 → 继续走分支 */
export function SayLinePanel({
  step,
  npcName,
  onResolved,
}: {
  step: SayLine;
  npcName: string;
  onResolved: (pass: boolean) => void;
}) {
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [error, setError] = useState<string | null>(null);
  const hold = useHoldToSpeak((t) => setInput((p) => (p ? `${p}${t}` : t)));

  const say = async () => {
    const line = input.trim();
    if (!line || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.dramaSay({
        npcName,
        sceneContext: step.context ?? '',
        intent: step.intent,
        playerLine: line,
      });
      setVerdict(res.data);
    } catch {
      // 网络/密钥失败:留住输入并给明确反馈,别静默
      setError(G.sayError);
    } finally {
      setBusy(false);
    }
  };

  if (verdict) {
    return (
      <View style={styles.box}>
        <Text style={[styles.badge, verdict.pass ? styles.pass : styles.fail]}>
          {verdict.pass ? G.sayPass : G.sayFail}
        </Text>
        <View style={styles.bubble}>
          <Text style={styles.bubbleText}>{verdict.reply}</Text>
        </View>
        {!verdict.pass && verdict.hint ? <Text style={styles.hint}>💡 {verdict.hint}</Text> : null}
        <Pressable onPress={() => onResolved(verdict.pass)} style={styles.contBtn}>
          <Text style={styles.contText}>{G.cont}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.box}>
      <Text style={styles.prompt}>{G.sayPrompt}</Text>
      <TextInput
        testID="sayline-input"
        style={styles.input}
        value={input}
        onChangeText={setInput}
        placeholder={G.sayPlaceholder}
        placeholderTextColor="#A89F8E"
        multiline
        editable={!busy}
      />
      <View style={styles.row}>
        <Pressable
          onPressIn={hold.onPressIn}
          onPressOut={hold.onPressOut}
          style={[styles.holdBtn, hold.holding && styles.holdActive]}
        >
          <Text style={styles.holdText}>{hold.holding ? G.sayHoldActive : G.sayHoldIdle}</Text>
        </Pressable>
        <Pressable onPress={say} disabled={busy} style={[styles.sayBtn, busy && styles.sayBtnOff]}>
          {busy ? <ActivityIndicator color="#F4EFE4" /> : <Text style={styles.sayText}>{G.sayBtn}</Text>}
        </Pressable>
      </View>
      {busy ? <Text style={styles.thinking}>{G.sayThinking}</Text> : null}
      {error && !busy ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const INK = '#3D3229';

const styles = StyleSheet.create({
  box: { gap: 10 },
  prompt: { fontSize: 15, fontWeight: '700', color: INK },
  input: {
    minHeight: 44,
    maxHeight: 120,
    backgroundColor: '#FFFDF7',
    borderWidth: 2,
    borderColor: INK,
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 15,
    color: INK,
  },
  row: { flexDirection: 'row', gap: 8 },
  holdBtn: {
    flex: 1,
    paddingVertical: 11,
    alignItems: 'center',
    backgroundColor: '#FFFDF7',
    borderWidth: 2,
    borderColor: INK,
    borderRadius: 6,
  },
  holdActive: { backgroundColor: '#E7E0D2' },
  holdText: { fontSize: 14, fontWeight: '600', color: INK },
  sayBtn: {
    paddingHorizontal: 22,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: INK,
    borderRadius: 6,
  },
  sayBtnOff: { opacity: 0.6 },
  sayText: { fontSize: 15, fontWeight: '700', color: '#F4EFE4' },
  thinking: { fontSize: 13, color: '#8A8377', textAlign: 'center' },
  error: { fontSize: 13, color: '#B3402F', textAlign: 'center' },
  badge: { fontSize: 15, fontWeight: '800', textAlign: 'center' },
  pass: { color: '#3F7A4E' },
  fail: { color: '#B3402F' },
  bubble: {
    backgroundColor: '#FFFDF7',
    borderWidth: 2,
    borderColor: INK,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  bubbleText: { fontSize: 15, color: INK },
  hint: { fontSize: 13, color: '#8A8377' },
  contBtn: { alignSelf: 'flex-end', paddingHorizontal: 18, paddingVertical: 8, backgroundColor: INK, borderRadius: 6 },
  contText: { fontSize: 15, fontWeight: '700', color: '#F4EFE4' },
});
