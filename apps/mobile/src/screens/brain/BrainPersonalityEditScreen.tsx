import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MemoryFragment, UserPersonaSettings } from '@xzz/shared';
import { MEMORY_USER_PROFILE_CHAR_LIMIT } from '@xzz/shared';
import { brainLogicHints } from '../../brain/logicHints';
import { identityPreview, soulPreview, userPreview } from '../../lib/personaUi';
import { api } from '../../lib/api';
import { BrainMemoryFragmentList } from '../../components/brain/BrainMemoryFragmentList';
import { BrainMetricBar } from '../../components/brain/BrainMetricBar';
import { BrainScreenShell } from '../../components/brain/BrainScreenShell';
import { zh } from '../../locales/zh-CN';
import type { BrainStackParamList } from '../../navigation/types';
import { evaBrain } from '../../theme/evaBrain';

type Props = NativeStackScreenProps<BrainStackParamList, 'BrainPersonalityEdit'>;

export function BrainPersonalityEditScreen({ navigation }: Props) {
  const [settings, setSettings] = useState<UserPersonaSettings>({});
  const [learned, setLearned] = useState<MemoryFragment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [personaRes, memoryRes] = await Promise.all([
        api.getPersona(),
        api.listMemories({ scope: 'user', category: 'user_profile', includeSuppressed: true }),
      ]);
      setSettings(personaRes.data);
      setLearned(
        memoryRes.data.filter((f) => f.status !== 'deleted' && f.status !== 'pending'),
      );
    } catch {
      setError(zh.brain.states.loadFailed);
      setSettings({});
      setLearned([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const notSet = zh.me.personalityNotSet;
  const manualRows = [
    {
      key: 'identity' as const,
      label: zh.me.personalityIdentity,
      preview: identityPreview(settings, notSet),
      route: 'SettingsPersonalityIdentity' as const,
    },
    {
      key: 'soul' as const,
      label: zh.me.personalitySoul,
      preview: soulPreview(settings, notSet),
      route: 'SettingsPersonalitySoul' as const,
    },
    {
      key: 'user' as const,
      label: zh.me.personalityUser,
      preview: userPreview(settings, notSet),
      route: 'SettingsPersonalityUser' as const,
    },
  ];

  const learnedChars = learned.reduce((n, f) => n + (f.content?.length ?? 0), 0);

  return (
    <BrainScreenShell
      title={zh.brain.sections.persona}
      hint={brainLogicHints.persona}
      onBack={() => navigation.goBack()}
      loading={loading}
      error={error}
      onReload={() => void load()}
    >
      <Text style={styles.sectionTitle}>{zh.brain.personaPage.manualTitle}</Text>
      <Text style={styles.sectionIntro}>{zh.brain.personaPage.manualIntro}</Text>
      {manualRows.map((row) => (
        <Pressable
          key={row.key}
          style={styles.row}
          onPress={() => navigation.navigate(row.route)}
          accessibilityRole="button"
        >
          <View style={styles.rowText}>
            <Text style={styles.label}>{row.label}</Text>
            <Text style={styles.value} numberOfLines={2}>
              {row.preview}
            </Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </Pressable>
      ))}

      <Text style={[styles.sectionTitle, styles.sectionTitleGap]}>
        {zh.brain.personaPage.learnedTitle}
      </Text>
      <Text style={styles.sectionIntro}>{zh.brain.personaPage.learnedIntro}</Text>
      <BrainMetricBar
        label={zh.brain.hermes.profileLimit}
        used={learnedChars}
        limit={MEMORY_USER_PROFILE_CHAR_LIMIT}
      />
      <BrainMemoryFragmentList
        items={learned}
        emptyLabel={zh.brain.personaPage.learnedEmpty}
        onChanged={() => void load()}
        onOpenDetail={(id) => navigation.navigate('BrainMemoryDetail', { fragmentId: id })}
      />
      <Pressable
        style={styles.linkRow}
        onPress={() => navigation.navigate('BrainLongMemory')}
        accessibilityRole="button"
      >
        <Text style={styles.linkText}>{zh.brain.personaPage.goLongMemory}</Text>
        <Text style={styles.chevron}>›</Text>
      </Pressable>
    </BrainScreenShell>
  );
}

const styles = StyleSheet.create({
  sectionTitle: {
    marginHorizontal: 12,
    marginBottom: 6,
    color: evaBrain.accentBright,
    fontSize: 15,
    fontWeight: '700',
  },
  sectionTitleGap: {
    marginTop: 8,
  },
  sectionIntro: {
    marginHorizontal: 12,
    marginBottom: 10,
    color: evaBrain.textMuted,
    fontSize: 13,
    lineHeight: 19,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 12,
    marginBottom: 10,
    padding: 14,
    backgroundColor: evaBrain.bgCard,
    borderRadius: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: evaBrain.border,
  },
  rowText: { flex: 1 },
  label: {
    color: evaBrain.accent,
    fontSize: 12,
    marginBottom: 4,
  },
  value: {
    color: evaBrain.text,
    fontSize: 14,
    lineHeight: 20,
  },
  chevron: {
    color: evaBrain.textDim,
    fontSize: 22,
    marginLeft: 8,
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 12,
    marginTop: 4,
    marginBottom: 16,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: evaBrain.bgElevated,
    borderRadius: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: evaBrain.borderSubtle,
  },
  linkText: {
    flex: 1,
    color: evaBrain.info,
    fontSize: 14,
  },
});
