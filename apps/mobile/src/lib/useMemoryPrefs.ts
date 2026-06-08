import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { api } from './api';
import { apiErrorText } from './apiError';
import { appAlert } from './appAlert';

/**
 * 记忆偏好屏的共享逻辑(原 BrainMemoryPrefs / SettingsMemoryPrefs 两屏各一份重复)。
 * 仅状态/IO;渲染与样式由各屏自带的外壳(大脑 shell / 微信 header)各自决定。
 */
export function useMemoryPrefs() {
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getMemorySettings();
      setEnabled(res.data.autoExtractEnabled);
    } catch {
      setEnabled(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const onToggle = useCallback(
    (value: boolean) => {
      setEnabled(value); // 乐观更新
      setSaving(true);
      void api
        .patchMemorySettings({ autoExtractEnabled: value })
        .catch((e) => {
          appAlert('保存失败', apiErrorText(e).message);
          void load();
        })
        .finally(() => setSaving(false));
    },
    [load],
  );

  return { enabled, loading, saving, onToggle, reload: load };
}
