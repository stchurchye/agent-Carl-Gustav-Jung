import { useEffect, useRef, useState } from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { WeChatChatHeader } from '../../../components/WeChatChatHeader';
import { PixelSprite } from '../../../components/pixel/PixelSprite';
import { buildDogCharacter } from '../../../pixel/buildDog';
import { ensureSpeechPermissions, isIosSimulator } from '../../../lib/speech/localRecognition';
import { wechatChatStyles } from '../../../theme/wechatChat';
import { zh } from '../../../locales/zh-CN';
import { DEFAULT_DOG } from '@xzz/shared';
import type { GroupStackParamList } from '../../../navigation/types';
import {
  ESCAPE_TUNING,
  finishCalibration,
  observeLoudness,
  startEscape,
  tick,
  type EscapeState,
} from './model';

const G = zh.games.escape;
const STEP_MS = 50;
/** 「按住喊」给出的等效振幅(落在 ESR -2..10 区间的“大声”) */
const HOLD_RAW = 8;
const DOG_SIZE = 56;
const DOG_SPRITE = buildDogCharacter(DEFAULT_DOG).still;

type Props = NativeStackScreenProps<GroupStackParamList, 'GameEscape'>;

/** 狗狗越狱:声音(麦克风/按住喊)= 狗绳,一安静狗就冲门,记最长坚持时间 */
export function GameEscapeScreen(_props: Props) {
  const insets = useSafeAreaInsets();
  const [state, setState] = useState<EscapeState>(() => startEscape());
  const holdingRef = useRef(false);
  const micRawRef = useRef(0);
  const calibAccumRef = useRef(0);
  const [laneW, setLaneW] = useState(0);

  // 单循环:校准累时 + 物理推进,统一 STEP_MS 步进
  useEffect(() => {
    const id = setInterval(() => {
      setState((s) => {
        const raw = Math.max(holdingRef.current ? HOLD_RAW : 0, micRawRef.current);
        let next = observeLoudness(s, raw);
        if (next.phase === 'calibrating') {
          calibAccumRef.current += STEP_MS;
          if (calibAccumRef.current >= ESCAPE_TUNING.calibrateMs) next = finishCalibration(next);
        } else if (next.phase === 'playing') {
          next = tick(next, STEP_MS);
        }
        return next;
      });
      micRawRef.current *= 0.6; // 麦克风读数自然衰减,避免事件稀疏时卡在高位
    }, STEP_MS);
    return () => clearInterval(id);
  }, []);

  // 真机:开麦取振幅;模拟器/无权限跳过,只用「按住喊」
  useEffect(() => {
    if (isIosSimulator()) return;
    let active = true;
    void (async () => {
      const ok = await ensureSpeechPermissions();
      if (!ok || !active) return;
      try {
        ExpoSpeechRecognitionModule.start({
          lang: 'zh-CN',
          interimResults: false,
          continuous: true,
          volumeChangeEventOptions: { enabled: true, intervalMillis: 100 },
        });
      } catch {
        // 起麦失败不致命:仍可用「按住喊」玩
      }
    })();
    return () => {
      active = false;
      try {
        ExpoSpeechRecognitionModule.stop();
      } catch {
        // ignore
      }
    };
  }, []);

  useSpeechRecognitionEvent('volumechange', (e) => {
    micRawRef.current = Math.max(micRawRef.current, e.value);
  });

  const restart = () => {
    calibAccumRef.current = 0;
    holdingRef.current = false;
    micRawRef.current = 0;
    setState(startEscape());
  };

  const seconds = (state.elapsedMs / 1000).toFixed(1);

  return (
    <View style={wechatChatStyles.page}>
      <WeChatChatHeader title={G.name} showBack />
      <View style={[styles.body, { paddingBottom: Math.max(insets.bottom, 24) }]}>
        {state.phase === 'calibrating' ? (
          <View style={styles.calib}>
            <Text style={styles.calibTitle}>{G.calibrateTitle}</Text>
            <Text style={styles.calibHint}>{G.calibrateHint}</Text>
          </View>
        ) : (
          <View style={styles.statusRow}>
            <Text style={styles.holding}>{G.holding(seconds)}</Text>
            <View style={styles.gripWrap}>
              <Text style={styles.gripLabel}>{G.gripLabel}</Text>
              <View style={styles.gripTrack}>
                <View style={[styles.gripFill, { width: `${Math.round(state.grip * 100)}%` }]} />
              </View>
            </View>
          </View>
        )}

        <View style={styles.lane} onLayout={(e) => setLaneW(e.nativeEvent.layout.width)}>
          <View style={styles.door} />
          <View style={[styles.dogWrap, { left: Math.max(0, state.position * (laneW - DOG_SIZE)) }]}>
            <PixelSprite sprite={DOG_SPRITE} size={DOG_SIZE} />
          </View>
        </View>

        <Pressable
          testID="hold-grip"
          onPressIn={() => {
            holdingRef.current = true;
          }}
          onPressOut={() => {
            holdingRef.current = false;
          }}
          style={({ pressed }) => [styles.holdBtn, pressed && styles.holdBtnDown]}
        >
          <Text style={styles.holdText}>{G.hold}</Text>
        </Pressable>
        <Text style={styles.micHint}>{G.micHint}</Text>
      </View>

      {state.phase === 'escaped' ? (
        <View style={styles.overlay}>
          <View style={styles.overlayCard}>
            <Text style={styles.overTitle}>{G.escaped}</Text>
            <Text style={styles.overScore}>{G.finalScore(seconds)}</Text>
            <Pressable onPress={restart} style={styles.restartBtn}>
              <Text style={styles.restartText}>{G.restart}</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const INK = '#3D3229';

const styles = StyleSheet.create({
  body: { flex: 1, paddingHorizontal: 20, paddingTop: 16 },
  calib: { alignItems: 'center', gap: 8, marginBottom: 12 },
  calibTitle: { fontSize: 18, fontWeight: '800', color: INK },
  calibHint: { fontSize: 13, color: '#8A8377', textAlign: 'center' },
  statusRow: { marginBottom: 12, gap: 8 },
  holding: { fontSize: 16, fontWeight: '700', color: INK },
  gripWrap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  gripLabel: { fontSize: 13, color: '#8A8377' },
  gripTrack: {
    flex: 1,
    height: 12,
    backgroundColor: '#E7E0D2',
    borderRadius: 6,
    overflow: 'hidden',
  },
  gripFill: { height: '100%', backgroundColor: '#B3402F' },
  lane: {
    flex: 1,
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: INK,
    borderRadius: 6,
    backgroundColor: '#FFFDF7',
    marginVertical: 16,
    overflow: 'hidden',
  },
  door: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: 10,
    backgroundColor: '#6E6759',
  },
  dogWrap: { position: 'absolute' },
  holdBtn: {
    paddingVertical: 18,
    borderRadius: 6,
    backgroundColor: INK,
    alignItems: 'center',
  },
  holdBtnDown: { backgroundColor: '#B3402F' },
  holdText: { fontSize: 18, fontWeight: '800', color: '#F4EFE4' },
  micHint: { fontSize: 12, color: '#8A8377', textAlign: 'center', marginTop: 8 },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
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
    gap: 10,
  },
  overTitle: { fontSize: 18, fontWeight: '800', color: INK },
  overScore: { fontSize: 15, color: INK },
  restartBtn: {
    marginTop: 6,
    paddingHorizontal: 22,
    paddingVertical: 10,
    backgroundColor: INK,
    borderRadius: 4,
  },
  restartText: { fontSize: 15, fontWeight: '700', color: '#F4EFE4' },
});
