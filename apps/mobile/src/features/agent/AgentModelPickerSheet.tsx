/**
 * M5B: compose-time agent model picker.
 * Uses built-in Modal (no third-party bottom-sheet). Half-screen slide-up.
 * missingKeys is passed from parent (computed via SecureStore) to keep this component pure.
 */
import React from 'react';
import {
  Modal,
  View,
  Text,
  Pressable,
  ScrollView,
  Alert,
  StyleSheet,
} from 'react-native';
import { AGENT_LLM_MODEL_OPTIONS, type AgentLlmModelOption } from '@xzz/shared';
import type { MissingKeys } from './useAgentModelPicker';
import { colors } from '../../theme/colors';

type Props = {
  visible: boolean;
  current: AgentLlmModelOption;
  missingKeys: MissingKeys;
  onPick: (opt: AgentLlmModelOption) => void;
  onClose: () => void;
  onConfigureKeys: () => void;
};

const VENDOR_ORDER = ['deepseek', 'anthropic', 'openai', 'moonshot', 'google'] as const;
const VENDOR_LABELS: Record<string, string> = {
  deepseek: 'DeepSeek',
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  moonshot: 'Moonshot',
  google: 'Google',
};

export function AgentModelPickerSheet({
  visible,
  current,
  missingKeys,
  onPick,
  onClose,
  onConfigureKeys,
}: Props) {
  const grouped = VENDOR_ORDER.map((vendor) => ({
    vendor,
    options: AGENT_LLM_MODEL_OPTIONS.filter((o) => o.vendor === vendor),
  })).filter((g) => g.options.length > 0);

  const handleTap = (opt: AgentLlmModelOption) => {
    const keyMissing = missingKeys[opt.requiresKey];
    if (keyMissing) {
      Alert.alert(
        '未配置 API Key',
        `使用 ${opt.label} 需要配置 ${opt.requiresKey === 'deepseek' ? 'DeepSeek' : 'ZenMux'} Key。`,
        [
          { text: '取消', style: 'cancel' },
          { text: '去配置', onPress: onConfigureKeys },
        ],
      );
      return;
    }
    onPick(opt);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <Text style={styles.title}>选择 Agent 模型</Text>
        <ScrollView>
          {grouped.map(({ vendor, options }) => (
            <View key={vendor}>
              <Text style={styles.vendorLabel}>{VENDOR_LABELS[vendor] ?? vendor}</Text>
              {options.map((opt) => {
                const keyMissing = missingKeys[opt.requiresKey];
                const isSelected = opt.modelId === current.modelId;
                return (
                  <Pressable
                    key={opt.modelId}
                    style={[styles.row, isSelected && styles.rowSelected]}
                    onPress={() => handleTap(opt)}
                  >
                    <View style={styles.rowInner}>
                      <Text style={[styles.rowLabel, keyMissing && styles.rowDisabled]}>
                        {opt.label}
                        {isSelected ? ' ✓' : ''}
                      </Text>
                      {opt.hint ? (
                        <Text style={[styles.rowHint, keyMissing && styles.rowDisabled]}>
                          {opt.hint}
                          {keyMissing ? ' · 未配置 Key' : ''}
                        </Text>
                      ) : keyMissing ? (
                        <Text style={styles.rowDisabled}>未配置 Key</Text>
                      ) : null}
                    </View>
                  </Pressable>
                );
              })}
            </View>
          ))}
        </ScrollView>
        <Pressable style={styles.closeBtn} onPress={onClose}>
          <Text style={styles.closeBtnText}>关闭</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: colors.backdrop,
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 16,
    paddingBottom: 24,
    maxHeight: '75%',
  },
  handle: {
    width: 40,
    height: 4,
    backgroundColor: colors.border,
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 8,
    marginBottom: 12,
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
    textAlign: 'center',
  },
  vendorLabel: {
    fontSize: 12,
    color: colors.textMuted,
    fontWeight: '600',
    marginTop: 12,
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  row: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    marginBottom: 2,
  },
  rowSelected: {
    backgroundColor: colors.selectedBg,
  },
  rowInner: {
    flex: 1,
  },
  rowLabel: {
    fontSize: 15,
    color: colors.text,
  },
  rowHint: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  rowDisabled: {
    color: colors.textTertiary,
  },
  closeBtn: {
    marginTop: 16,
    paddingVertical: 12,
    backgroundColor: colors.fill,
    borderRadius: 10,
    alignItems: 'center',
  },
  closeBtnText: {
    fontSize: 15,
    color: colors.text,
  },
});
