import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking } from 'react-native';
import { appAlert } from '../lib/appAlert';
import { apiErrorText } from '../lib/apiError';
import { isAuthErrorMessage } from '../lib/authEvents';
import {
  cancelCloudRecording,
  hasCloudHoldSpeech,
  prepareCloudRecording,
  startCloudRecording,
  stopCloudRecordingAndTranscribe,
} from '../lib/cloudSpeech';
import { ensureSpeechPermissions } from '../lib/speech/localRecognition';

const MIN_HOLD_MS = 400;

/** 按住说话：录音后经 ZenMux · Gemini 2.5 Flash Lite 转文字 */
export function useHoldToSpeak(onComplete: (text: string) => void) {
  const [holding, setHolding] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [recordingAvailable, setRecordingAvailable] = useState<boolean | null>(null);

  const fingerDownRef = useRef(false);
  const sessionActiveRef = useRef(false);
  const listenStartedRef = useRef(0);

  useEffect(() => {
    void (async () => {
      setRecordingAvailable(await hasCloudHoldSpeech());
    })();
  }, []);

  const onPressIn = useCallback(async () => {
    if (transcribing) return;
    if (recordingAvailable === false) {
      appAlert(
        '按住说话不可用',
        '需要重新编译 App 以启用录音（expo-av）。请在 apps/mobile 执行 npx pod-install 后重装。',
      );
      return;
    }

    fingerDownRef.current = true;
    listenStartedRef.current = Date.now();

    const ok = await ensureSpeechPermissions();
    if (!fingerDownRef.current) return;
    if (!ok) {
      appAlert('需要权限', '需要麦克风权限才能按住说话', [
        { text: '去设置', onPress: () => void Linking.openSettings() },
        { text: '知道了', style: 'cancel' },
      ]);
      return;
    }

    try {
      await prepareCloudRecording();
      await startCloudRecording();
      sessionActiveRef.current = true;
      setHolding(true);
    } catch (e) {
      sessionActiveRef.current = false;
      setHolding(false);
      appAlert('没开始录音', String(e));
    }
  }, [recordingAvailable, transcribing]);

  const onPressOut = useCallback(() => {
    fingerDownRef.current = false;

    if (!sessionActiveRef.current) {
      void cancelCloudRecording();
      setHolding(false);
      return;
    }

    const held = Date.now() - listenStartedRef.current;
    sessionActiveRef.current = false;
    setHolding(false);

    if (held < MIN_HOLD_MS) {
      void cancelCloudRecording();
      appAlert('提示', '请按住多说一会儿');
      return;
    }

    setTranscribing(true);
    void (async () => {
      try {
        const text = await stopCloudRecordingAndTranscribe();
        if (text && isAuthErrorMessage(text)) {
          return;
        }
        if (text) onComplete(text);
        else appAlert('没听清', '请再按住说一次');
      } catch (e) {
        const { message, hint } = apiErrorText(e);
        appAlert(message, hint ?? message);
      } finally {
        setTranscribing(false);
      }
    })();
  }, [onComplete]);

  return { holding: holding || transcribing, transcribing, onPressIn, onPressOut };
}
