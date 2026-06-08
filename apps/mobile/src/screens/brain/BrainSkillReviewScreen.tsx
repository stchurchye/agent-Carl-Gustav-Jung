import { useCallback, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WeChatChatHeader } from '../../components/WeChatChatHeader';
import { api, type TopicSkill } from '../../lib/api';
import { apiErrorText } from '../../lib/apiError';
import { zh } from '../../locales/zh-CN';
import type { BrainStackParamList } from '../../navigation/types';
import { colors, typography } from '../../theme/colors';
import { wechatChatStyles } from '../../theme/wechatChat';

type Props = NativeStackScreenProps<BrainStackParamList, 'BrainSkillReview'>;

/**
 * M5-S1:自蒸馏建议技能评审屏。
 * 只管 source='auto_distilled' 的技能(手写技能 source=null,不在本面管理)。
 * 待评审(enabled=false)→ 启用(注入后续同类 run)/ 忽略(删除);已启用 → 停用。
 */
export function BrainSkillReviewScreen(_props: Props) {
  const insets = useSafeAreaInsets();
  const t = zh.brain.skillReview;
  const [skills, setSkills] = useState<TopicSkill[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.listSkills();
      setSkills(res.data.skills.filter((s) => s.source === 'auto_distilled'));
    } catch {
      setSkills([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const setEnabled = (id: string, enabled: boolean) => {
    setBusyId(id);
    void api
      .patchSkill(id, { enabled })
      .then(load)
      .catch((e) => Alert.alert(t.actionFailed, apiErrorText(e).message))
      .finally(() => setBusyId(null));
  };

  const dismiss = (id: string) => {
    Alert.alert(t.dismissTitle, t.dismissConfirm, [
      { text: t.cancel, style: 'cancel' },
      {
        text: t.dismiss,
        style: 'destructive',
        onPress: () => {
          setBusyId(id);
          void api
            .deleteSkill(id)
            .then(load)
            .catch((e) => Alert.alert(t.actionFailed, apiErrorText(e).message))
            .finally(() => setBusyId(null));
        },
      },
    ]);
  };

  const pending = skills.filter((s) => !s.enabled);
  const active = skills.filter((s) => s.enabled);

  const card = (s: TopicSkill, actions: ReactNode) => (
    <View key={s.id} style={styles.card}>
      <Text style={styles.cardTitle}>{s.title}</Text>
      <Text style={styles.cardBody} numberOfLines={4}>
        {s.content}
      </Text>
      <View style={styles.actions}>{actions}</View>
    </View>
  );

  return (
    <View style={wechatChatStyles.page}>
      <WeChatChatHeader title={t.title} showBack />
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: Math.max(insets.bottom, 16) + 12 },
        ]}
      >
        {loading ? (
          <ActivityIndicator color={colors.primary} style={styles.loader} />
        ) : skills.length === 0 ? (
          <Text style={styles.empty}>{t.empty}</Text>
        ) : (
          <>
            <Text style={styles.intro}>{t.intro}</Text>
            {pending.length > 0 ? (
              <>
                <Text style={styles.groupLabel}>
                  {t.pendingGroup}（{pending.length}）
                </Text>
                {pending.map((s) =>
                  card(
                    s,
                    <>
                      <Pressable
                        style={[styles.btn, styles.enable]}
                        disabled={busyId === s.id}
                        onPress={() => setEnabled(s.id, true)}
                      >
                        <Text style={styles.btnText}>{t.enable}</Text>
                      </Pressable>
                      <Pressable
                        style={[styles.btn, styles.dismissBtn]}
                        disabled={busyId === s.id}
                        onPress={() => dismiss(s.id)}
                      >
                        <Text style={styles.btnText}>{t.dismiss}</Text>
                      </Pressable>
                    </>,
                  ),
                )}
              </>
            ) : null}
            {active.length > 0 ? (
              <>
                <Text style={styles.groupLabel}>
                  {t.enabledGroup}（{active.length}）
                </Text>
                {active.map((s) =>
                  card(
                    s,
                    <Pressable
                      style={[styles.btn, styles.disable]}
                      disabled={busyId === s.id}
                      onPress={() => setEnabled(s.id, false)}
                    >
                      <Text style={styles.btnTextMuted}>{t.disable}</Text>
                    </Pressable>,
                  ),
                )}
              </>
            ) : null}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingTop: 12, paddingHorizontal: 16 },
  loader: { marginVertical: 32 },
  empty: {
    marginTop: 40,
    textAlign: 'center',
    color: colors.textMuted,
    fontSize: typography.caption,
  },
  intro: {
    color: colors.textMuted,
    fontSize: typography.caption,
    lineHeight: 20,
    marginBottom: 12,
  },
  groupLabel: {
    color: colors.textMuted,
    fontSize: typography.caption,
    fontWeight: '600',
    marginTop: 8,
    marginBottom: 6,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    padding: 14,
    marginBottom: 10,
  },
  cardTitle: { fontSize: typography.body, fontWeight: '600', color: colors.text },
  cardBody: {
    marginTop: 6,
    fontSize: typography.caption,
    color: colors.textMuted,
    lineHeight: 20,
  },
  actions: { flexDirection: 'row', marginTop: 12, gap: 10 },
  btn: { paddingVertical: 7, paddingHorizontal: 16, borderRadius: 6 },
  enable: { backgroundColor: colors.primary },
  dismissBtn: { backgroundColor: colors.danger },
  disable: { backgroundColor: colors.fill },
  btnText: { color: colors.onPrimary, fontSize: typography.caption, fontWeight: '600' },
  btnTextMuted: { color: colors.text, fontSize: typography.caption, fontWeight: '600' },
});
