import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking } from 'react-native';
import { useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { appAlert } from '../lib/appAlert';
import {
  abortListening,
  ensureSpeechPermissions,
  isIosSimulator,
  prepareSpeechEngine,
  startListening,
  stopListening,
} from '../lib/speech/localRecognition';
import { speechErrorMessage } from '../lib/speech/errors';

function joinTranscript(results: { transcript?: string }[] | undefined): string {
  if (!results?.length) return '';
  return results
    .map((r) => r.transcript?.trim() ?? '')
    .filter(Boolean)
    .join('');
}

/** 输入框内听写：点一下开始持续写入，再点一下暂停 */
export function useInlineDictation(onAppend: (text: string, opts: { replaceInterim: boolean }) => void) {
  const [dictating, setDictating] = useState(false);
  const dictatingRef = useRef(false);
  const committedRef = useRef('');
  const interimRef = useRef('');

  useSpeechRecognitionEvent('result', (event) => {
    if (!dictatingRef.current) return;
    const text = joinTranscript(event.results);
    if (!text) return;
    if (event.isFinal) {
      committedRef.current = `${committedRef.current}${text}`;
      interimRef.current = '';
      onAppend(committedRef.current, { replaceInterim: true });
      committedRef.current = '';
    } else {
      interimRef.current = text;
      onAppend(`${committedRef.current}${text}`, { replaceInterim: true });
    }
  });

  useSpeechRecognitionEvent('end', () => {
    if (!dictatingRef.current) return;
    dictatingRef.current = false;
    setDictating(false);
    const tail = (committedRef.current + interimRef.current).trim();
    committedRef.current = '';
    interimRef.current = '';
    if (tail) onAppend(tail, { replaceInterim: false });
  });

  useSpeechRecognitionEvent('error', (event) => {
    if (!dictatingRef.current) return;
    dictatingRef.current = false;
    setDictating(false);
    if (event.error !== 'aborted') {
      appAlert('听写提示', speechErrorMessage(event.error, event.message));
    }
  });

  const stop = useCallback(() => {
    if (!dictatingRef.current) return;
    dictatingRef.current = false;
    setDictating(false);
    stopListening();
  }, []);

  const start = useCallback(async () => {
    if (isIosSimulator()) {
      appAlert('提示', '模拟器上听写不可用，请用真机测试');
      return false;
    }
    const ok = await ensureSpeechPermissions();
    if (!ok) {
      appAlert('需要权限', speechErrorMessage('not-allowed'), [
        { text: '去设置', onPress: () => void Linking.openSettings() },
        { text: '知道了', style: 'cancel' },
      ]);
      return false;
    }
    const engine = await prepareSpeechEngine();
    if (!engine.ok) {
      appAlert('听写不可用', speechErrorMessage('service-not-allowed'));
      return false;
    }
    committedRef.current = '';
    interimRef.current = '';
    dictatingRef.current = true;
    setDictating(true);
    startListening({ continuous: true, interimResults: true });
    return true;
  }, []);

  const toggle = useCallback(async (): Promise<boolean> => {
    if (dictatingRef.current) {
      stop();
      return true;
    }
    return start();
  }, [start, stop]);

  useEffect(() => () => {
    dictatingRef.current = false;
    abortListening();
  }, []);

  return { dictating, toggle, stop };
}
