import { useEffect, useMemo, useRef, useState } from 'react';
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
import { SokobanPanel } from './SokobanPanel';
import { PairingPanel } from './PairingPanel';
import { ProwlPanel } from './ProwlPanel';
import { KoulliPanel } from './KoulliPanel';
import { ZitherPanel } from './ZitherPanel';
import { DebatePanel } from './DebatePanel';
import { SceneBackground } from './SceneBackground';
import { currentStep, type DramaState } from './story';
import {
  initSave,
  advanceSave,
  restartAct,
  isResumable,
  checkpointActLabel,
  serializeSave,
  parseSave,
  type DramaSave,
} from './dramaSave';
import { loadDramaSaveRaw, saveDramaRaw, clearDramaSave } from './dramaSaveStore';

const G = zh.games.drama;

type Props = NativeStackScreenProps<GroupStackParamList, 'GameDrama'>;

export function DramaScreen(_props: Props) {
  const insets = useSafeAreaInsets();
  const [save, setSave] = useState<DramaSave>(() => initSave(ACT1));
  const [resume, setResume] = useState<DramaSave | null>(null); // 待确认的"继续上次"存档
  const hydrated = useRef(false);
  const state: DramaState = save.current;

  const scene = ACT1.scenes[state.sceneId];
  const step = currentStep(ACT1, state);
  const castSprites = useMemo(
    () => scene.cast.map((id) => ({ id, m: castMember(id) })).filter((c) => c.m),
    [scene],
  );
  // 当前说话的角色(对白/说台词步)→ 高亮它、压暗旁人
  const speakerId = step && (step.kind === 'line' || step.kind === 'sayline') ? step.who : null;

  const advance = (input?: { choice?: number; pass?: boolean; solved?: boolean }) =>
    setSave((s) => advanceSave(ACT1, s, input));
  const restart = () => setSave(initSave(ACT1)); // 从头再看(自动存档随之清空)
  const backToAct = () => setSave((s) => restartAct(s)); // 回到本幕开头

  // 进屏读存档:有可续进度 → 弹「继续上次」
  useEffect(() => {
    let alive = true;
    void loadDramaSaveRaw().then((raw) => {
      if (!alive) return;
      const s = parseSave(raw, ACT1);
      if (isResumable(ACT1, s)) setResume(s);
      hydrated.current = true;
    });
    return () => {
      alive = false;
    };
  }, []);

  // 自动存档:有进度则存,回到起点/结束态则清(读完档后才开始,避免首帧误清掉旧档)
  useEffect(() => {
    if (!hydrated.current) return;
    if (isResumable(ACT1, save)) void saveDramaRaw(serializeSave(save));
    else void clearDramaSave();
  }, [save]);

  // branch 步无 UI:按旗标自动推进
  useEffect(() => {
    if (step?.kind === 'branch') setSave((s) => advanceSave(ACT1, s));
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
        {scene.act ? (
          <View style={styles.actBanner} pointerEvents="none">
            <Text style={styles.actBannerText}>{scene.act}</Text>
          </View>
        ) : null}
        <View style={styles.cast}>
          {castSprites.map(({ id, m }) => {
            const crown = m!.headdress ? buildHeaddress(m!.headdress) : null;
            const speaking = id === speakerId;
            const dim = speakerId != null && !speaking;
            const size = castSprites.length >= 4 ? 50 : castSprites.length === 3 ? 60 : 72;
            return (
              <View
                key={id}
                testID={speaking ? `cast-speaking-${id}` : `cast-${id}`}
                style={[styles.castSlot, dim && styles.castDim, speaking && styles.castSpeaking]}
              >
                <View style={{ width: size, height: size }}>
                  <PixelSprite sprite={buildDogCharacter(m!.dog).still} size={size} />
                  {crown ? <PixelSprite sprite={crown} size={size} style={StyleSheet.absoluteFill} /> : null}
                </View>
                <Text style={[styles.castName, speaking && styles.castNameOn]}>{m!.name}</Text>
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
        ) : step?.kind === 'sokoban' ? (
          <SokobanPanel
            key={`${state.sceneId}-${state.stepIndex}`}
            step={step}
            onResolved={(solved) => advance({ solved })}
          />
        ) : step?.kind === 'pairing' ? (
          <PairingPanel
            key={`${state.sceneId}-${state.stepIndex}`}
            step={step}
            onResolved={(solved) => advance({ solved })}
          />
        ) : step?.kind === 'prowl' ? (
          <ProwlPanel
            key={`${state.sceneId}-${state.stepIndex}`}
            step={step}
            onResolved={(solved) => advance({ solved })}
          />
        ) : step?.kind === 'koulli' ? (
          <KoulliPanel
            key={`${state.sceneId}-${state.stepIndex}`}
            step={step}
            onResolved={(solved) => advance({ solved })}
          />
        ) : step?.kind === 'zither' ? (
          <ZitherPanel
            key={`${state.sceneId}-${state.stepIndex}`}
            step={step}
            onResolved={(solved) => advance({ solved })}
          />
        ) : step?.kind === 'debate' ? (
          <DebatePanel
            key={`${state.sceneId}-${state.stepIndex}`}
            step={step}
            onResolved={(won) => advance({ solved: won })}
          />
        ) : null}
      </View>
      </KeyboardAvoidingView>

      {step?.kind === 'ending' ? (
        <View style={styles.overlay}>
          <View style={styles.overlayCard}>
            <Text style={styles.endText}>{step.text}</Text>
            <View style={styles.endBtns}>
              {step.outcome === 'bad' && save.checkpoint.sceneId !== ACT1.start ? (
                <Pressable testID="drama-back-act" onPress={backToAct} style={styles.contBtn}>
                  <Text style={styles.contText}>{G.restartAct}</Text>
                </Pressable>
              ) : null}
              <Pressable testID="drama-restart" onPress={restart} style={[styles.contBtn, styles.ghostBtn]}>
                <Text style={[styles.contText, styles.ghostText]}>{G.restart}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      ) : null}

      {resume ? (
        <View style={styles.overlay}>
          <View style={styles.overlayCard}>
            <Text style={styles.resumeTitle}>{G.resumeTitle}</Text>
            <Text style={styles.resumeSub}>{checkpointActLabel(ACT1, resume) ?? ''}</Text>
            <View style={styles.endBtns}>
              <Pressable
                testID="drama-resume"
                onPress={() => {
                  setSave(resume);
                  setResume(null);
                }}
                style={styles.contBtn}
              >
                <Text style={styles.contText}>{G.resumeContinue}</Text>
              </Pressable>
              <Pressable
                testID="drama-fresh"
                onPress={() => {
                  setResume(null);
                  setSave(initSave(ACT1));
                }}
                style={[styles.contBtn, styles.ghostBtn]}
              >
                <Text style={[styles.contText, styles.ghostText]}>{G.resumeRestart}</Text>
              </Pressable>
            </View>
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
  actBanner: {
    position: 'absolute',
    top: 14,
    alignSelf: 'center',
    backgroundColor: 'rgba(61,50,41,0.78)',
    borderWidth: 1,
    borderColor: '#D7AE4E',
    borderRadius: 6,
    paddingHorizontal: 18,
    paddingVertical: 7,
  },
  actBannerText: { fontSize: 15, fontWeight: '800', color: '#F1D67E', letterSpacing: 2 },
  cast: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'flex-end', padding: 16 },
  castSlot: { alignItems: 'center', gap: 4 },
  castDim: { opacity: 0.5 },
  castSpeaking: { transform: [{ translateY: -5 }] }, // 说话者微微抬升
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
  castNameOn: { backgroundColor: '#B3402F', color: '#F1D67E' }, // 说话者名牌高亮

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
  endBtns: { flexDirection: 'row', gap: 10, flexWrap: 'wrap', justifyContent: 'center' },
  ghostBtn: { backgroundColor: '#FFFDF7', borderWidth: 2, borderColor: INK },
  ghostText: { color: INK },
  resumeTitle: { fontSize: 17, fontWeight: '800', color: INK, textAlign: 'center' },
  resumeSub: { fontSize: 14, color: '#8A8377', textAlign: 'center' },
});
