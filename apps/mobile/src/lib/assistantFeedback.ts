import { getAssistantThinkingLine } from './assistantCopy';
import { speakText, stopSpeaking } from './tts';

type ExpoAv = typeof import('expo-av');

let speakGeneration = 0;
let readySound: import('expo-av').Audio.Sound | null = null;

function bumpGeneration(): number {
  speakGeneration += 1;
  return speakGeneration;
}

function speakTextAsync(text: string): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return Promise.resolve();
  return new Promise((resolve) => {
    void speakText(trimmed, {
      onDone: () => resolve(),
      onStopped: () => resolve(),
      onError: () => resolve(),
    });
  });
}

async function getAv(): Promise<ExpoAv | null> {
  try {
    return await import('expo-av');
  } catch {
    return null;
  }
}

/** 短促提示音：助手回复已就绪（不阻塞 UI） */
export function playAssistantReadySound(): void {
  void (async () => {
    const av = await getAv();
    if (!av) return;

    try {
      await av.Audio.setAudioModeAsync({
        playsInSilentModeIOS: true,
        allowsRecordingIOS: false,
      });
      if (readySound) {
        try {
          await readySound.unloadAsync();
        } catch {
          // ignore
        }
        readySound = null;
      }
      const { sound } = await av.Audio.Sound.createAsync(
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../../assets/sounds/assistant-ready.wav'),
        { shouldPlay: true, volume: 0.65 },
      );
      readySound = sound;
      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.isLoaded && status.didJustFinish) {
          void sound.unloadAsync();
          if (readySound === sound) readySound = null;
        }
      });
    } catch {
      // ignore
    }
  })();
}

/** 等待气泡：念出文案，不阻塞界面 */
export function announceAssistantWaiting(text?: string): void {
  const gen = bumpGeneration();
  void (async () => {
    await stopSpeaking();
    if (gen !== speakGeneration) return;
    const line = text ?? (await getAssistantThinkingLine());
    await speakTextAsync(line);
  })();
}

/** 回复到达：提示音 + 朗读，与打字机展示并行 */
export function announceAssistantReplyParallel(fullText: string): void {
  const trimmed = fullText.trim();
  if (!trimmed) return;

  const gen = bumpGeneration();
  void stopSpeaking();
  playAssistantReadySound();
  void (async () => {
    if (gen !== speakGeneration) return;
    await speakTextAsync(trimmed);
  })();
}

export async function cancelAssistantFeedback(): Promise<void> {
  bumpGeneration();
  await stopSpeaking();
  if (readySound) {
    try {
      await readySound.stopAsync();
      await readySound.unloadAsync();
    } catch {
      // ignore
    }
    readySound = null;
  }
}
