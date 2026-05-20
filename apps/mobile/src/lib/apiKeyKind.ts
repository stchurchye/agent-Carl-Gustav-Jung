import { api } from './api';
import {
  clearDeepSeekApiKey,
  getDeepSeekApiKey,
  maskApiKey,
  setDeepSeekApiKey,
} from './deepseekKey';
import {
  clearDashScopeApiKey,
  getDashScopeApiKey,
  maskDashScopeApiKey,
  setDashScopeApiKey,
} from './dashscopeKey';
import {
  clearZenMuxApiKey,
  getZenMuxApiKey,
  maskZenMuxApiKey,
  setZenMuxApiKey,
} from './zenmuxKey';
import { zh } from '../locales/zh-CN';

export type ApiKeyKind = 'deepseek' | 'zenmux' | 'dashscope';

export type ApiKeyKindConfig = {
  title: string;
  hint: string;
  placeholder: string;
  saveLabel: string;
  verifyLabel: string;
  configuredLabel: string;
  notConfiguredLabel: string;
  verifyOk: string;
  verifyFail: string;
  savedMessage: string;
  clearedMessage: string;
  getLocal: () => Promise<string | null>;
  setLocal: (value: string) => Promise<void>;
  clearLocal: () => Promise<void>;
  mask: (key: string) => string;
  getServerConfigured: () => Promise<boolean>;
  verify: () => Promise<{ message: string }>;
};

export const API_KEY_KINDS: ApiKeyKind[] = ['deepseek', 'zenmux', 'dashscope'];

export function apiKeyKindConfig(kind: ApiKeyKind): ApiKeyKindConfig {
  switch (kind) {
    case 'deepseek':
      return {
        title: zh.me.deepseekTitle,
        hint: zh.me.deepseekHint,
        placeholder: zh.me.deepseekPlaceholder,
        saveLabel: zh.me.deepseekSave,
        verifyLabel: zh.me.deepseekVerify,
        configuredLabel: zh.me.deepseekConfigured,
        notConfiguredLabel: zh.me.deepseekNotConfigured,
        verifyOk: zh.me.deepseekVerifyOk,
        verifyFail: zh.me.deepseekVerifyFail,
        savedMessage: zh.me.keySaved,
        clearedMessage: zh.me.keyCleared,
        getLocal: getDeepSeekApiKey,
        setLocal: setDeepSeekApiKey,
        clearLocal: clearDeepSeekApiKey,
        mask: maskApiKey,
        getServerConfigured: async () => {
          try {
            const res = await api.getDeepSeekStatus();
            return res.data.configured;
          } catch {
            return false;
          }
        },
        verify: async () => {
          const res = await api.verifyDeepSeekKey();
          return { message: res.data.message || zh.me.deepseekVerifyOk };
        },
      };
    case 'zenmux':
      return {
        title: zh.me.zenmuxTitle,
        hint: zh.me.zenmuxHint,
        placeholder: zh.me.zenmuxPlaceholder,
        saveLabel: zh.me.zenmuxSave,
        verifyLabel: zh.me.zenmuxVerify,
        configuredLabel: zh.me.zenmuxConfigured,
        notConfiguredLabel: zh.me.zenmuxNotConfigured,
        verifyOk: zh.me.zenmuxVerifyOk,
        verifyFail: zh.me.zenmuxVerifyFail,
        savedMessage: zh.me.keySaved,
        clearedMessage: zh.me.keyCleared,
        getLocal: getZenMuxApiKey,
        setLocal: setZenMuxApiKey,
        clearLocal: clearZenMuxApiKey,
        mask: maskZenMuxApiKey,
        getServerConfigured: async () => {
          try {
            const res = await api.getZenMuxStatus();
            return res.data.configured;
          } catch {
            return false;
          }
        },
        verify: async () => {
          const res = await api.verifyZenMuxKey();
          return { message: res.data.message || zh.me.zenmuxVerifyOk };
        },
      };
    case 'dashscope':
      return {
        title: zh.me.dashscopeTitle,
        hint: zh.me.dashscopeHint,
        placeholder: zh.me.dashscopePlaceholder,
        saveLabel: zh.me.dashscopeSave,
        verifyLabel: zh.me.dashscopeVerify,
        configuredLabel: zh.me.dashscopeConfigured,
        notConfiguredLabel: zh.me.dashscopeNotConfigured,
        verifyOk: zh.me.dashscopeVerifyOk,
        verifyFail: zh.me.dashscopeVerifyFail,
        savedMessage: zh.me.keySaved,
        clearedMessage: zh.me.keyCleared,
        getLocal: getDashScopeApiKey,
        setLocal: setDashScopeApiKey,
        clearLocal: clearDashScopeApiKey,
        mask: maskDashScopeApiKey,
        getServerConfigured: async () => {
          try {
            const res = await api.getDashScopeStatus();
            return res.data.configured;
          } catch {
            return false;
          }
        },
        verify: async () => {
          const res = await api.verifyDashScopeKey();
          return { message: res.data.message || zh.me.dashscopeVerifyOk };
        },
      };
  }
}

export async function loadApiKeyStatus(kind: ApiKeyKind): Promise<{
  configured: boolean;
  statusLabel: string;
}> {
  const cfg = apiKeyKindConfig(kind);
  const local = await cfg.getLocal();
  const server = await cfg.getServerConfigured();
  const configured = Boolean(local) || server;
  return {
    configured,
    statusLabel: configured ? cfg.configuredLabel : cfg.notConfiguredLabel,
  };
}
