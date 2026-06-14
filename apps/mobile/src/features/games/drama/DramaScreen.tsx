import { useEffect, useMemo, useState } from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Keyboard, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WeChatChatHeader } from '../../../components/WeChatChatHeader';
import { PixelSprite } from '../../../components/pixel/PixelSprite';
import { buildDogCharacter } from '../../../pixel/buildDog';
import { buildHeaddress } from '../../../pixel/grids/palaceParts';
import { wechatChatStyles } from '../../../theme/wechatChat';
import { zh } from '../../../locales/zh-CN';
import type { GroupStackParamList } from '../../../navigation/types';
import { ACT1 } from './script';
import { castMember } from './cast';
import { SayLinePanel } from './SayLinePanel';
import { DeducePanel } from './DeducePanel';
import { SceneBackground } from './SceneBackground';
import { advanceStory, currentStep, startStory, type DramaState } from './story';

const G = zh.games.drama;

type Props = NativeStackScreenProps<GroupStackParamList, 'GameDrama'>;

export function DramaScreen(_props: Props) {
  const insets = useSafeAreaInsets();
  const [state, setState] = useState<DramaState>(() => startStory(ACT1));

  const scene = ACT1.scenes[state.sceneId];
  const step = currentStep(ACT1, state);
  const castSprites = useMemo(
    () => scene.cast.map((id) => ({ id, m: castMember(id) })).filter((c) => c.m),
    [scene],
  );

  const advance = (input?: { choice?: number; pass?: boolean; solved?: boolean }) =>
    setState((s) => advanceStory(ACT1, s, input));
  const restart = () => setState(startStory(ACT1));

  // branch 步无 UI:按旗标自动推进
  useEffect(() => {
    if (step?.kind === 'branch') setState((s) => advanceStory(ACT1, s));
  }, [step]);

  return (
    <View style={wechatChatStyles.page}>
      <WeChatChatHeader title={G.name} showBack />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {/* 点场景任意处收起键盘(说台词时键盘别挡住按钮) */}
      <Pressable style={styles.stage} onPress={() => Keyboard.dismiss()}>
        <View style={StyleSheet.absoluteFill}>
          <SceneBackground bg={scene.bg} />
        </View>
        <View style={styles.cast}>
          {castSprites.map(({ id, m }) => {
            const crown = m!.headdress ? buildHeaddress(m!.headdress) : null;
            return (
              <View key={id} style={styles.castSlot}>
                <View style={styles.dogStack}>
                  <PixelSprite sprite={buildDogCharacter(m!.dog).still} size={72} />
                  {crown ? <PixelSprite sprite={crown} size={72} style={StyleSheet.absoluteFill} /> : null}
                </View>
                <Text style={styles.castName}>{m!.name}</Text>
              </View>
            );
          })}
        </View>
      </Pressable>

      <View style={[styles.panel, { paddingBottom: Math.max(insets.bottom, 16) }]}>
        {step?.kind === 'line' ? (
          <>
            <Text style={styles.speaker}>{castMember(step.who)?.name ?? ''}</Text>
            <Text style={styles.lineText}>{step.text}</Text>
            <Pressable onPress={() => advance()} style={styles.contBtn}>
              <Text style={styles.contText}>{G.cont}</Text>
            </Pressable>
          </>
        ) : step?.kind === 'choice' ? (
          <>
            {step.prompt ? <Text style={styles.prompt}>{step.prompt}</Text> : null}
            {step.options.map((opt, i) => (
              <Pressable key={i} onPress={() => advance({ choice: i })} style={styles.optBtn}>
                <Text style={styles.optText}>{opt.label}</Text>
              </Pressable>
            ))}
          </>
        ) : step?.kind === 'sayline' ? (
          <SayLinePanel
            key={`${state.sceneId}-${state.stepIndex}`}
            step={step}
            npcName={castMember(step.who)?.name ?? ''}
            onResolved={(pass) => advance({ pass })}
          />
        ) : step?.kind === 'deduce' ? (
          <DeducePanel
            key={`${state.sceneId}-${state.stepIndex}`}
            step={step}
            onResolved={(solved) => advance({ solved })}
          />
        ) : null}
      </View>
      </KeyboardAvoidingView>

      {step?.kind === 'ending' ? (
        <View style={styles.overlay}>
          <View style={styles.overlayCard}>
            <Text style={styles.endText}>{step.text}</Text>
            <Pressable onPress={restart} style={styles.contBtn}>
              <Text style={styles.contText}>{G.restart}</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const INK = '#3D3229';

const styles = StyleSheet.create({
  flex: { flex: 1 },
  stage: { flex: 1, justifyContent: 'flex-end' },
  cast: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'flex-end', padding: 16 },
  castSlot: { alignItems: 'center', gap: 4 },
  dogStack: { width: 72, height: 72 },
  castName: {
    fontSize: 12,
    color: '#FFFDF7',
    fontWeight: '700',
    backgroundColor: 'rgba(61,50,41,0.6)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: 'hidden',
  },
  panel: {
    backgroundColor: '#FFFDF7',
    borderTopWidth: 2,
    borderTopColor: INK,
    paddingHorizontal: 16,
    paddingTop: 14,
    minHeight: 160,
    gap: 10,
  },
  speaker: { fontSize: 14, fontWeight: '800', color: '#B3402F' },
  lineText: { fontSize: 16, color: INK, lineHeight: 24 },
  prompt: { fontSize: 15, fontWeight: '700', color: INK },
  contBtn: { alignSelf: 'flex-end', paddingHorizontal: 18, paddingVertical: 8, backgroundColor: INK, borderRadius: 6 },
  contText: { fontSize: 15, fontWeight: '700', color: '#F4EFE4' },
  optBtn: {
    backgroundColor: '#FFFDF7',
    borderWidth: 2,
    borderColor: INK,
    borderRadius: 6,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  optText: { fontSize: 15, color: INK },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  overlayCard: {
    backgroundColor: '#F4EFE4',
    borderWidth: 2,
    borderColor: INK,
    borderRadius: 6,
    paddingHorizontal: 28,
    paddingVertical: 24,
    alignItems: 'center',
    gap: 14,
    marginHorizontal: 24,
  },
  endText: { fontSize: 16, fontWeight: '700', color: INK, textAlign: 'center', lineHeight: 24 },
});
