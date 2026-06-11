import { useCallback, useEffect, useMemo, useState } from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  ACCENT_COLORS,
  DOG_ACCESSORIES,
  DOG_BODIES,
  DOG_COATS,
  DOG_EARS,
  DOG_PATTERNS,
  DOG_PERSONALITIES,
  DOG_PRESETS,
  DOG_TAILS,
  HUMAN_PRESETS,
  presetDogForSeed,
  presetHumanForSeed,
  type DogConfig,
  type HumanConfig,
} from '@xzz/shared';
import { AppTextInput } from '../components/AppTextInput';
import { PixelCharacter } from '../components/pixel/PixelCharacter';
import { PixelSprite } from '../components/pixel/PixelSprite';
import { WeChatChatHeader } from '../components/WeChatChatHeader';
import { useAuth } from '../components/AuthGate';
import { api } from '../lib/api';
import { apiErrorText } from '../lib/apiError';
import { appAlert } from '../lib/appAlert';
import { buildDogCharacter } from '../pixel/buildDog';
import { buildHumanCharacter } from '../pixel/buildHuman';
import { HUMAN_MOTION, PERSONALITY_MOTION } from '../pixel/palette';
import { useLayout } from '../theme/layout';
import { zh } from '../locales/zh-CN';
import type { GroupStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<GroupStackParamList, 'SettingsMyDog'>;

type Tab = 'pick' | 'custom' | 'human';

function randomOf<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** 挑狗/自定义细节/挑小人 + 给狗和自己起名(领养流程) */
export function SettingsPixelAvatarScreen({ navigation }: Props) {
  const { user, applyAuthUser } = useAuth();
  const { isTablet } = useLayout();
  const seed = user?.id ?? 'me';
  const [dog, setDog] = useState<DogConfig>(
    () => user?.pixelAvatar?.dog ?? presetDogForSeed(seed).dog,
  );
  const [human, setHuman] = useState<HumanConfig>(
    () => user?.pixelAvatar?.human ?? presetHumanForSeed(seed).human,
  );
  const [tab, setTab] = useState<Tab>('pick');
  const [dogName, setDogName] = useState('');
  const [callMe, setCallMe] = useState('');
  const [namesLoaded, setNamesLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void api
      .getPersona()
      .then((r) => {
        setDogName(r.data.identity?.assistantName ?? '');
        setCallMe(r.data.user?.preferredName ?? '');
        setNamesLoaded(true);
      })
      .catch(() => setNamesLoaded(true));
  }, []);

  const dogCharacter = useMemo(() => buildDogCharacter(dog), [dog]);
  const humanCharacter = useMemo(() => buildHumanCharacter(human), [human]);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      const res = await api.updatePixelAvatar({ v: 1, dog, human });
      await applyAuthUser(res.data.user);
      const personaPatch: Parameters<typeof api.patchPersona>[0] = {};
      if (dogName.trim()) personaPatch.identity = { assistantName: dogName.trim() };
      if (callMe.trim()) personaPatch.user = { preferredName: callMe.trim() };
      if (personaPatch.identity || personaPatch.user) {
        await api.patchPersona(personaPatch);
      }
      navigation.goBack();
    } catch (e) {
      appAlert(zh.pixelAvatar.saveFailed, apiErrorText(e).message);
    } finally {
      setSaving(false);
    }
  }, [dog, human, dogName, callMe, applyAuthUser, navigation]);

  const dimChips = <K extends string>(
    label: string,
    values: readonly K[],
    selected: K,
    names: Record<K, string>,
    onPick: (v: K) => void,
  ) => (
    <View style={styles.dimRow} key={label}>
      <Text style={styles.dimLabel}>{label}</Text>
      <View style={styles.chipWrap}>
        {values.map((v) => (
          <Pressable
            key={v}
            onPress={() => onPick(v)}
            style={[styles.chip, v === selected && styles.chipActive]}
          >
            <Text style={[styles.chipText, v === selected && styles.chipTextActive]}>
              {names[v]}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );

  return (
    <View style={styles.page}>
      <WeChatChatHeader title={zh.pixelAvatar.title} showBack />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.intro}>{zh.pixelAvatar.adoptIntro}</Text>

        <View style={styles.previewRow}>
          <PixelCharacter
            character={dogCharacter}
            size={120}
            motion={PERSONALITY_MOTION[dog.personality]}
            animated
            testID="dog-preview"
          />
          <PixelCharacter character={humanCharacter} size={72} motion={HUMAN_MOTION} animated />
        </View>

        <View style={styles.segmentRow}>
          {(
            [
              ['pick', zh.pixelAvatar.segmentPick],
              ['custom', zh.pixelAvatar.segmentCustom],
              ['human', zh.pixelAvatar.segmentHuman],
            ] as Array<[Tab, string]>
          ).map(([key, label]) => (
            <Pressable
              key={key}
              onPress={() => setTab(key)}
              style={[styles.segment, tab === key && styles.segmentActive]}
              testID={`segment-${key}`}
            >
              <Text style={[styles.segmentText, tab === key && styles.segmentTextActive]}>
                {label}
              </Text>
            </Pressable>
          ))}
        </View>

        {tab === 'pick' ? (
          <View style={styles.grid}>
            {DOG_PRESETS.map((p) => {
              const selected = JSON.stringify(p.dog) === JSON.stringify(dog);
              return (
                <Pressable
                  key={p.id}
                  onPress={() => setDog(p.dog)}
                  style={[styles.cellBox, isTablet && styles.cellBoxTablet, selected && styles.cellSelected]}
                  testID={`preset-${p.id}`}
                >
                  <PixelSprite sprite={buildDogCharacter(p.dog).still} size={56} />
                  <Text style={styles.cellName}>{p.name}</Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        {tab === 'custom' ? (
          <View>
            <Pressable
              style={styles.randomBtn}
              onPress={() =>
                setDog({
                  body: randomOf(DOG_BODIES),
                  coat: randomOf(DOG_COATS),
                  pattern: randomOf(DOG_PATTERNS),
                  ears: randomOf(DOG_EARS),
                  tail: randomOf(DOG_TAILS),
                  accessory: randomOf(DOG_ACCESSORIES),
                  accessoryColor: randomOf(ACCENT_COLORS),
                  personality: randomOf(DOG_PERSONALITIES),
                })
              }
            >
              <Text style={styles.randomText}>🎲 {zh.pixelAvatar.random}</Text>
            </Pressable>
            {dimChips(zh.pixelAvatar.dims.body, DOG_BODIES, dog.body, zh.pixelAvatar.bodyNames, (v) =>
              setDog({ ...dog, body: v }),
            )}
            {dimChips(zh.pixelAvatar.dims.coat, DOG_COATS, dog.coat, zh.pixelAvatar.coatNames, (v) =>
              setDog({ ...dog, coat: v }),
            )}
            {dimChips(
              zh.pixelAvatar.dims.pattern,
              DOG_PATTERNS,
              dog.pattern,
              zh.pixelAvatar.patternNames,
              (v) => setDog({ ...dog, pattern: v }),
            )}
            {dimChips(zh.pixelAvatar.dims.ears, DOG_EARS, dog.ears, zh.pixelAvatar.earsNames, (v) =>
              setDog({ ...dog, ears: v }),
            )}
            {dimChips(zh.pixelAvatar.dims.tail, DOG_TAILS, dog.tail, zh.pixelAvatar.tailNames, (v) =>
              setDog({ ...dog, tail: v }),
            )}
            {dimChips(
              zh.pixelAvatar.dims.accessory,
              DOG_ACCESSORIES,
              dog.accessory,
              zh.pixelAvatar.accessoryNames,
              (v) => setDog({ ...dog, accessory: v }),
            )}
            {dog.accessory !== 'none'
              ? dimChips(
                  zh.pixelAvatar.dims.accessoryColor,
                  ACCENT_COLORS,
                  dog.accessoryColor,
                  zh.pixelAvatar.accentNames,
                  (v) => setDog({ ...dog, accessoryColor: v }),
                )
              : null}
            {dimChips(
              zh.pixelAvatar.dims.personality,
              DOG_PERSONALITIES,
              dog.personality,
              zh.pixelAvatar.personalityNames,
              (v) => setDog({ ...dog, personality: v }),
            )}
          </View>
        ) : null}

        {tab === 'human' ? (
          <View style={styles.grid}>
            {HUMAN_PRESETS.map((p) => {
              const selected = JSON.stringify(p.human) === JSON.stringify(human);
              return (
                <Pressable
                  key={p.id}
                  onPress={() => setHuman(p.human)}
                  style={[styles.cellBox, isTablet && styles.cellBoxTablet, selected && styles.cellSelected]}
                  testID={`human-${p.id}`}
                >
                  <PixelSprite sprite={buildHumanCharacter(p.human).still} size={56} />
                  <Text style={styles.cellName}>{p.name}</Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        <View style={styles.nameBlock}>
          <Text style={styles.nameLabel}>{zh.pixelAvatar.dogNameLabel}</Text>
          <AppTextInput
            value={dogName}
            onChangeText={setDogName}
            placeholder={zh.pixelAvatar.dogNamePh}
            editable={namesLoaded}
            maxLength={20}
          />
          <Text style={styles.nameLabel}>{zh.pixelAvatar.callMeLabel}</Text>
          <AppTextInput
            value={callMe}
            onChangeText={setCallMe}
            placeholder={zh.pixelAvatar.callMePh}
            editable={namesLoaded}
            maxLength={20}
          />
        </View>

        <Pressable
          style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
          onPress={() => void save()}
          disabled={saving}
          accessibilityRole="button"
          testID="pixel-avatar-save"
        >
          <Text style={styles.saveText}>{zh.pixelAvatar.save}</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#FAF9F5' },
  content: { padding: 14, paddingBottom: 48 },
  intro: { fontSize: 14, color: '#6E6759', lineHeight: 20, marginBottom: 10 },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 18,
    paddingVertical: 12,
    borderWidth: 2,
    borderColor: '#3D3229',
    borderRadius: 4,
    backgroundColor: '#FFFDF7',
    marginBottom: 12,
  },
  segmentRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  segment: {
    flex: 1,
    borderWidth: 2,
    borderColor: '#3D3229',
    borderRadius: 4,
    paddingVertical: 8,
    alignItems: 'center',
    backgroundColor: '#F0EEE6',
  },
  segmentActive: { backgroundColor: '#C15F3C' },
  segmentText: { fontWeight: '700', color: '#3D3229', fontSize: 13 },
  segmentTextActive: { color: '#FFFDF7' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  cellBox: {
    width: '22.7%',
    alignItems: 'center',
    paddingVertical: 8,
    borderWidth: 2,
    borderColor: '#D8D2C2',
    borderRadius: 4,
    backgroundColor: '#FFFDF7',
  },
  cellBoxTablet: { width: '15.5%' },
  cellSelected: { borderColor: '#C15F3C', backgroundColor: '#FBF1E9' },
  cellName: { marginTop: 4, fontSize: 11, color: '#3D3229' },
  randomBtn: {
    alignSelf: 'flex-start',
    borderWidth: 2,
    borderColor: '#3D3229',
    borderRadius: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#FFFDF7',
    marginBottom: 10,
  },
  randomText: { fontWeight: '700', color: '#3D3229', fontSize: 13 },
  dimRow: { marginBottom: 10 },
  dimLabel: { fontSize: 13, fontWeight: '700', color: '#6E6759', marginBottom: 6 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    borderWidth: 2,
    borderColor: '#D8D2C2',
    borderRadius: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: '#FFFDF7',
  },
  chipActive: { borderColor: '#C15F3C', backgroundColor: '#FBF1E9' },
  chipText: { fontSize: 13, color: '#3D3229' },
  chipTextActive: { fontWeight: '700', color: '#A1502F' },
  nameBlock: { marginTop: 16, gap: 6 },
  nameLabel: { fontSize: 13, fontWeight: '700', color: '#6E6759', marginTop: 6 },
  saveBtn: {
    marginTop: 18,
    borderWidth: 2,
    borderColor: '#3D3229',
    borderRadius: 4,
    backgroundColor: '#C15F3C',
    alignItems: 'center',
    paddingVertical: 12,
  },
  saveBtnDisabled: { opacity: 0.6 },
  saveText: { color: '#FFFDF7', fontWeight: '800', fontSize: 16 },
});
