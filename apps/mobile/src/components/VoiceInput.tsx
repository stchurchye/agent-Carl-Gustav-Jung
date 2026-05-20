import type { ReactNode } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { appAlert } from '../lib/appAlert';
import { useSpeechRecognitionEvent } from 'expo-speech-recognition';
import {
  abortListening,
  ensureSpeechPermissions,
  isIosSimulator,
  isRecognitionAvailable,
  prepareAndroidOfflinePack,
  prepareSpeechEngine,
  resetStartProfile,
  rotateStartProfile,
  startListening,
  stopListening,
} from '../lib/speech/localRecognition';
import { speechErrorMessage } from '../lib/speech/errors';
import { cancelAssistantFeedback } from '../lib/assistantFeedback';
import {
  cancelCloudRecording,
  hasCloudSpeech,
  startCloudRecording,
  stopCloudRecordingAndTranscribe,
} from '../lib/cloudSpeech';
import { apiErrorText } from '../lib/apiError';
import { chatIcons } from '../assets/chatIcons';
import { ChatUiIcon } from './ChatUiIcon';
import { colors, typography } from '../theme/colors';
import { zh } from '../locales/zh-CN';
import { PrimaryButton } from './PrimaryButton';

const MIN_HOLD_MS = 400;
const END_SETTLE_MS = 250;

/** 状态文案不展示在听写条第二行（只保留「正在听您说」） */
function isLiveTranscript(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/^正在听/.test(t)) return false;
  if (/^正在录音/.test(t)) return false;
  if (/^正在转成/.test(t)) return false;
  return true;
}

interface Props {
  onConfirm: (text: string) => void;
  label?: string;
  confirmPrimaryLabel?: string;
  disabled?: boolean;
  /** 嵌在底部输入栏时勿 flex:1，避免「按住说话」被压成一条 */
  embedded?: boolean;
  /** 与识图等并排：输入区用 children，左侧 leadingAction + 按住说话 */
  dock?: boolean;
  /** 工具行用图标代替文字（写作小助手） */
  iconToolbar?: boolean;
  leadingAction?: ReactNode;
  /** 工具行右侧，如「发送」 */
  trailingAction?: ReactNode;
  children?: ReactNode;
}

function joinTranscript(
  results: { transcript?: string }[] | undefined,
): string {
  if (!results?.length) return '';
  return results
    .map((r) => r.transcript?.trim() ?? '')
    .filter(Boolean)
    .join('');
}

/**
 * 按住说话 → 本地听写（不调 LLM）→「您说的是」确认
 */
export function VoiceInput({
  onConfirm,
  label = zh.writing.speak,
  confirmPrimaryLabel = zh.common.confirm,
  disabled,
  embedded,
  dock,
  iconToolbar,
  leadingAction,
  trailingAction,
  children,
}: Props) {
  const { height: windowHeight } = useWindowDimensions();
  const confirmScrollMaxHeight = Math.min(
    280,
    Math.max(160, Math.round(windowHeight * 0.32)),
  );
  const [listening, setListening] = useState(false);
  const [cloudMode, setCloudMode] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [interim, setInterim] = useState('');
  const [pending, setPending] = useState<string | null>(null);

  const fingerDownRef = useRef(false);
  const sessionActiveRef = useRef(false);
  const pressStartedAtRef = useRef(0);
  const listenStartedAtRef = useRef(0);
  const transcriptRef = useRef('');
  const finalTranscriptRef = useRef('');
  const errorHandledRef = useRef(false);
  const userCancelledRef = useRef(false);
  const startGenerationRef = useRef(0);
  const initRetryRef = useRef(0);
  const simulatorWarnedRef = useRef(false);

  useEffect(() => {
    void (async () => {
      const cloud = await hasCloudSpeech();
      const local = isRecognitionAvailable();
      // 模拟器听写基本不可用；真机优先本机听写，避免 ZenMux 云端失败时出现「出了点小问题」
      if (isIosSimulator()) {
        setCloudMode(false);
      } else {
        setCloudMode(cloud && !local);
      }
      try {
        await ensureSpeechPermissions();
        await prepareSpeechEngine();
        await prepareAndroidOfflinePack();
      } catch {
        // 预检失败不阻塞，按住说话时会再试
      }
    })();
  }, []);

  useSpeechRecognitionEvent('start', () => {
    sessionActiveRef.current = true;
    listenStartedAtRef.current = Date.now();
    setListening(true);
  });

  useSpeechRecognitionEvent('result', (event) => {
    const text = joinTranscript(event.results);
    if (!text) return;
    transcriptRef.current = text;
    setInterim(text);
    if (event.isFinal) {
      finalTranscriptRef.current = text;
    }
  });

  useSpeechRecognitionEvent('error', (event) => {
    sessionActiveRef.current = false;
    setListening(false);
    if (event.error === 'aborted' || userCancelledRef.current) {
      userCancelledRef.current = false;
      return;
    }

    const nativeMsg = (event.message ?? '').toLowerCase();
    const initFailed =
      nativeMsg.includes('initialize recognizer') ||
      nativeMsg.includes("can't initialize speech recognizer");

    if (initFailed && initRetryRef.current < 1 && rotateStartProfile() && fingerDownRef.current) {
      initRetryRef.current += 1;
      try {
        startListening();
        return;
      } catch {
        // 继续走下方提示
      }
    }

    errorHandledRef.current = true;
    const holdMs = Date.now() - (listenStartedAtRef.current || pressStartedAtRef.current);
    if (event.error === 'no-speech' && holdMs < MIN_HOLD_MS) {
      return;
    }
    appAlert('听写提示', speechErrorMessage(event.error, event.message));
  });

  useSpeechRecognitionEvent('end', () => {
    sessionActiveRef.current = false;
    setListening(false);

    const holdMs = Date.now() - (listenStartedAtRef.current || pressStartedAtRef.current);

    setTimeout(() => {
      if (errorHandledRef.current) {
        errorHandledRef.current = false;
        return;
      }
      if (userCancelledRef.current) {
        userCancelledRef.current = false;
        return;
      }

      const text = (finalTranscriptRef.current || transcriptRef.current).trim();
      if (text) {
        setPending(text);
        return;
      }

      if (holdMs < MIN_HOLD_MS) {
        appAlert('提示', zh.voice.holdLonger);
        return;
      }

      if (!disabled) {
        appAlert('没听清', speechErrorMessage('no-speech'));
      }
    }, END_SETTLE_MS);
  });

  const resetTranscript = () => {
    transcriptRef.current = '';
    finalTranscriptRef.current = '';
    setInterim('');
  };

  const handlePressIn = useCallback(async () => {
    if (disabled || sessionActiveRef.current || transcribing) return;

    if (cloudMode) {
      fingerDownRef.current = true;
      pressStartedAtRef.current = Date.now();
      setPending(null);
      resetTranscript();
      try {
        await cancelAssistantFeedback();
        await startCloudRecording();
        sessionActiveRef.current = true;
        listenStartedAtRef.current = Date.now();
        setListening(true);
      } catch (e) {
        const msg = String(e);
        setCloudMode(false);
        if (/permission|Permissions|原生模块|expo-av/i.test(msg)) {
          appAlert('听写提示', zh.voice.cloudFallbackLocal);
        } else {
          appAlert('听写没开始', msg);
        }
      }
      return;
    }

    const generation = ++startGenerationRef.current;
    fingerDownRef.current = true;
    pressStartedAtRef.current = Date.now();
    userCancelledRef.current = false;
    errorHandledRef.current = false;
    initRetryRef.current = 0;
    resetStartProfile();
    setPending(null);
    resetTranscript();

    const ok = await ensureSpeechPermissions();
    if (generation !== startGenerationRef.current) return;
    if (!fingerDownRef.current) return;

    if (!ok) {
      appAlert('需要权限', speechErrorMessage('not-allowed'), [
        { text: '去设置', onPress: () => void Linking.openSettings() },
        { text: '知道了', style: 'cancel' },
      ]);
      return;
    }

    const engine = await prepareSpeechEngine();
    if (generation !== startGenerationRef.current) return;
    if (!fingerDownRef.current) return;

    if (!engine.ok) {
      appAlert(
        '听写不可用',
        isIosSimulator() ? zh.voice.simulatorHint : speechErrorMessage('service-not-allowed'),
      );
      return;
    }

    if (engine.simulator && !simulatorWarnedRef.current) {
      simulatorWarnedRef.current = true;
      appAlert('提示', zh.voice.simulatorHint);
    }

    if (!fingerDownRef.current) return;

    try {
      startListening();
    } catch {
      appAlert('听写提示', '暂时无法开始听您说话，请稍后再试');
    }
  }, [disabled, cloudMode, transcribing]);

  const handlePressOut = useCallback(() => {
    fingerDownRef.current = false;

    if (cloudMode && sessionActiveRef.current) {
      sessionActiveRef.current = false;
      setListening(false);
      const held = Date.now() - listenStartedAtRef.current;
      if (held < MIN_HOLD_MS) {
        void cancelCloudRecording();
        appAlert('提示', zh.voice.holdLonger);
        return;
      }
      setTranscribing(true);
      void (async () => {
        try {
          const text = await stopCloudRecordingAndTranscribe();
          if (text) setPending(text);
          else appAlert('没听清', speechErrorMessage('no-speech'));
        } catch (e) {
          setCloudMode(false);
          const { message, hint } = apiErrorText(e);
          const extra = isRecognitionAvailable()
            ? '\n\n已改为本机听写，请再按住说一次。'
            : '\n\n也可在「我的」检查 ZenMux 密钥，或改用键盘输入。';
          appAlert(message, hint ? `${hint}${extra}` : message + extra);
        } finally {
          setTranscribing(false);
          setInterim('');
        }
      })();
      return;
    }

    if (!sessionActiveRef.current) {
      userCancelledRef.current = true;
      abortListening();
      return;
    }

    const held = Date.now() - listenStartedAtRef.current;
    if (held < MIN_HOLD_MS) {
      setTimeout(() => {
        if (!fingerDownRef.current && sessionActiveRef.current) {
          stopListening();
        }
      }, MIN_HOLD_MS - held);
      return;
    }

    stopListening();
  }, [cloudMode]);

  const handleCancelListen = () => {
    userCancelledRef.current = true;
    fingerDownRef.current = false;
    if (cloudMode) {
      void cancelCloudRecording();
    } else {
      abortListening();
    }
    sessionActiveRef.current = false;
    setListening(false);
    setTranscribing(false);
    resetTranscript();
  };

  return (
    <View style={[styles.wrap, embedded && styles.wrapEmbedded, dock && styles.wrapDock]}>
      {listening || transcribing ? (
        <View style={styles.listeningBar}>
          <View style={styles.listeningHeader}>
            <Text style={styles.listeningTitle}>
              {transcribing ? zh.writing.transcribingVoice : zh.writing.listening}
            </Text>
            <Pressable onPress={handleCancelListen} hitSlop={8}>
              <Text style={styles.cancelListen}>{zh.writing.cancel}</Text>
            </Pressable>
          </View>
          {interim.trim() ? (
            <Text style={styles.interim} numberOfLines={3}>
              {interim}
            </Text>
          ) : null}
        </View>
      ) : null}

      {pending && !listening ? (
        <View style={styles.confirmBox}>
          <Text style={styles.confirmLabel}>{zh.voice.youSaid}</Text>
          <ScrollView
            style={[styles.confirmScroll, { maxHeight: confirmScrollMaxHeight }]}
            contentContainerStyle={styles.confirmScrollContent}
            nestedScrollEnabled
            showsVerticalScrollIndicator
            keyboardShouldPersistTaps="handled"
          >
            <Text style={styles.confirmText}>{pending}</Text>
          </ScrollView>
          <View style={styles.confirmActions}>
            <PrimaryButton
              title={confirmPrimaryLabel}
              onPress={() => {
                onConfirm(pending);
                setPending(null);
                resetTranscript();
              }}
              style={styles.confirmBtn}
            />
            <PrimaryButton
              title={zh.voice.speakAgain}
              variant="secondary"
              onPress={() => {
                setPending(null);
                resetTranscript();
              }}
              style={styles.confirmBtn}
            />
          </View>
        </View>
      ) : null}

      {!pending ? children : null}

      {!pending ? (
        <View style={styles.toolRow}>
          {leadingAction}
          <Pressable
            style={[
              styles.btn,
              styles.btnFlex,
              iconToolbar && styles.btnIcon,
              listening && styles.btnActive,
              disabled && styles.btnDisabled,
            ]}
            onPressIn={handlePressIn}
            onPressOut={handlePressOut}
            disabled={disabled || transcribing}
            accessibilityRole="button"
            accessibilityLabel={
              transcribing
                ? zh.writing.transcribingVoice
                : listening
                  ? zh.writing.releaseToFinish
                  : label
            }
          >
            {iconToolbar ? (
              transcribing ? (
                <ActivityIndicator color={colors.primary} size="small" />
              ) : listening ? (
                <Text style={[styles.btnIconHint, styles.btnLabelActive]}>
                  {zh.writing.releaseToFinish}
                </Text>
              ) : (
                <ChatUiIcon source={chatIcons.llmVoice} size={22} active={!disabled} />
              )
            ) : (
              <Text style={[styles.btnLabel, (listening || transcribing) && styles.btnLabelActive]}>
                {transcribing
                  ? zh.writing.transcribingVoice
                  : listening
                    ? zh.writing.releaseToFinish
                    : label}
              </Text>
            )}
          </Pressable>
          {trailingAction}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, gap: 10 },
  wrapEmbedded: { flex: 0, flexGrow: 0, flexShrink: 0 },
  wrapDock: {
    flexShrink: 0,
    paddingHorizontal: 2,
    paddingVertical: 2,
    gap: 4,
  },
  toolRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 8,
  },
  listeningBar: {
    backgroundColor: colors.insertBg,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.insertBorder,
  },
  listeningHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    minHeight: 28,
  },
  listeningTitle: {
    flex: 1,
    fontSize: typography.caption,
    lineHeight: Math.round(typography.caption * 1.25),
    fontWeight: '600',
    color: colors.text,
  },
  interim: {
    marginTop: 4,
    fontSize: typography.caption,
    lineHeight: Math.round(typography.caption * 1.3),
    color: colors.textMuted,
  },
  cancelListen: {
    fontSize: typography.caption,
    color: colors.primary,
    fontWeight: '600',
  },
  confirmBox: {
    backgroundColor: colors.surface,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  confirmLabel: {
    fontSize: typography.caption,
    color: colors.textMuted,
    marginBottom: 6,
  },
  confirmScroll: {
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    backgroundColor: colors.background,
  },
  confirmScrollContent: {
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  confirmText: {
    fontSize: typography.body,
    lineHeight: typography.bodyLineHeight,
    color: colors.text,
  },
  confirmActions: { flexDirection: 'row', gap: 10 },
  confirmBtn: { flex: 1 },
  btn: {
    backgroundColor: colors.primarySoft,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    minHeight: 40,
  },
  btnFlex: { flex: 1 },
  btnIcon: {
    minHeight: 40,
    paddingVertical: 8,
  },
  btnActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  btnDisabled: { opacity: 0.5 },
  btnLabel: { fontSize: typography.button, color: colors.text, fontWeight: '600' },
  btnLabelActive: { color: colors.onPrimary },
  btnIconHint: {
    fontSize: typography.small,
    fontWeight: '600',
    textAlign: 'center',
    paddingHorizontal: 4,
  },
});
