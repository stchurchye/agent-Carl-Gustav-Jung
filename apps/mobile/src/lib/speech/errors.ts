import type { ExpoSpeechRecognitionErrorCode } from 'expo-speech-recognition';

const MESSAGES: Partial<Record<ExpoSpeechRecognitionErrorCode, string>> = {
  'not-allowed': '需要允许使用麦克风和语音识别，请在设置里打开',
  'no-speech': '没听清您说的话，请靠近手机再说一次，不着急',
  'speech-timeout': '没听清您说的话，请靠近手机再说一次，不着急',
  network: '听写需要连一下网，请打开无线网后再试',
  'language-not-supported': '这台手机暂不支持中文听写，请改用键盘输入',
  'service-not-allowed':
    '听写服务未就绪。请在「设置 → Siri 与搜索」打开 Siri，并在「设置 → 键盘」打开听写',
  'audio-capture': '麦克风或听写服务暂时不可用，请稍后再试',
  busy: '上一次的听写还没结束，请稍等一秒再试',
  aborted: '已取消',
};

function messageFromNativeText(message?: string): string | undefined {
  const m = (message ?? '').toLowerCase();
  if (
    m.includes('failed to initialize recognizer') ||
    m.includes("can't initialize speech recognizer") ||
    m.includes('initialize recognizer') ||
    m.includes('assets are not installed') ||
    m.includes('siri or dictation is disabled')
  ) {
    return (
      '听写引擎没启动成功。\n\n' +
      '• 真机：请打开「设置 → Siri 与搜索」里的 Siri，以及「设置 → 键盘 → 启用听写」\n' +
      '• 模拟器：多数情况下不支持语音听写，请换真机测试'
    );
  }
  return undefined;
}

export function speechErrorMessage(
  code: ExpoSpeechRecognitionErrorCode,
  fallback?: string,
): string {
  return messageFromNativeText(fallback) ?? MESSAGES[code] ?? fallback ?? '听写没成功，请再试一次';
}
