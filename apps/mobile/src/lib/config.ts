import Constants from 'expo-constants';
import { Platform } from 'react-native';
import NativeSourceCode from 'react-native/Libraries/NativeModules/specs/NativeSourceCode';
import { XZZ_API_PORT } from '@xzz/shared';

/** 从 Metro bundle 地址取电脑 IP（真机与 Metro 同机时最可靠） */
function hostFromScriptUrl(): string | null {
  try {
    const scriptURL = NativeSourceCode.getConstants().scriptURL;
    if (!scriptURL || scriptURL.startsWith('file:')) return null;
    const host = scriptURL.match(/^https?:\/\/([^/:]+)/)?.[1];
    if (!host || host === 'localhost' || host === '127.0.0.1') return null;
    return host;
  } catch {
    return null;
  }
}

/** 从 Expo 开发服务地址推断电脑 IP */
function hostFromExpoConfig(): string | null {
  const hostUri =
    Constants.expoConfig?.hostUri ??
    (Constants as { manifest2?: { extra?: { expoClient?: { hostUri?: string } } } }).manifest2
      ?.extra?.expoClient?.hostUri;

  if (!hostUri) return null;
  const host = hostUri.split(':')[0];
  if (!host || host === 'localhost' || host === '127.0.0.1') return null;
  return host;
}

function getDevHost(): string {
  // iOS 模拟器与 Mac 共用 127.0.0.1；勿用 Metro 的局域网 IP（易导致 API 3922 连不上）
  if (Platform.OS === 'ios' && !Constants.isDevice) {
    return '127.0.0.1';
  }

  const fromBundle = hostFromScriptUrl();
  if (fromBundle) return fromBundle;

  const fromExpo = hostFromExpoConfig();
  if (fromExpo) return fromExpo;

  if (Platform.OS === 'android') return '10.0.2.2';
  return '127.0.0.1';
}

/** 开发环境 API 地址（默认端口 3922） */
export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_URL ?? `http://${getDevHost()}:${XZZ_API_PORT}`;
