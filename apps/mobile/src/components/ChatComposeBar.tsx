import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
  type TextInput,
} from 'react-native';
import type { RefObject } from 'react';
import type { ContextUsage } from '@xzz/shared';
import { AppTextInput } from './AppTextInput';
import { ContextUsageControl } from './ContextUsageControl';
import { useInlineDictation } from '../hooks/useInlineDictation';
import { useHoldToSpeak } from '../hooks/useHoldToSpeak';
import { ensureSpeechPermissions } from '../lib/speech/localRecognition';
import { pickAssistantOcrImage } from '../lib/assistantOcrSession';
import { appAlert } from '../lib/appAlert';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, typography } from '../theme/colors';
import { wechat } from '../theme/wechat';
import { useLayout } from '../theme/layout';
import { zh } from '../locales/zh-CN';
import { composeBarIcons, type ComposeIconVariant } from '../assets/chatIcons';
import { ChatUiIcon } from './ChatUiIcon';

const COMPOSE_ICON_SIZE = 22;

export type ComposeMode = 'keyboard' | 'voice';

type Props = {
  value: string;
  onChangeText: (text: string) => void;
  onSend: () => void;
  /** 按住说话松开后直接发送文字 */
  onSendVoiceText?: (text: string) => void;
  /** 选中相册图片 */
  onPickImage?: (asset: { uri: string; base64?: string | null; mimeType?: string | null }) => void;
  placeholder?: string;
  busy?: boolean;
  disabled?: boolean;
  inputRef?: RefObject<TextInput | null>;
  contextUsage?: ContextUsage | null;
  contextUsageLoading?: boolean;
  /** 底部安全区（聊天全屏页由父级传入，首帧即固定） */
  bottomInset?: number;
  /** 为上下文环预留宽度，避免加载后输入栏横向跳动 */
  reserveContextSlot?: boolean;
  /** 上下文详情由父级在面板内展示（写作小助手） */
  onContextDetailOpen?: (usage: ContextUsage) => void;
  /** 长按上下文环 */
  onContextRingLongPress?: () => void;
  /** 上下文环放在发送/+ 之后，避免挤压输入框 */
  contextAfterTrailing?: boolean;
  /** 发送按钮文案（问 AI 模式时为「问 AI」） */
  sendLabel?: string;
  /** 问 AI 模式高亮发送钮 */
  sendVariant?: 'default' | 'askAi';
  /** 问 AI 模式：仅输入框外圈橙色描边 */
  askAiHighlight?: boolean;
  /** 输入栏图标配色：群聊普通模式用 human，其余默认 ai */
  composeIconVariant?: ComposeIconVariant;
};

const ASK_AI_ORANGE = '#FF9800';

/**
 * 微信式底部栏：左切换语音/键盘 · 中输入或按住说话 · 内嵌听写麦 · 键盘「发送」/右加号
 */
export function ChatComposeBar({
  value,
  onChangeText,
  onSend,
  onSendVoiceText,
  onPickImage,
  placeholder = '想说点什么',
  busy,
  disabled,
  inputRef,
  contextUsage,
  contextUsageLoading,
  bottomInset,
  reserveContextSlot,
  onContextDetailOpen,
  onContextRingLongPress,
  contextAfterTrailing,
  sendLabel,
  sendVariant = 'default',
  askAiHighlight = false,
  composeIconVariant = 'ai',
}: Props) {
  const icons = useMemo(() => composeBarIcons(composeIconVariant), [composeIconVariant]);
  const insets = useSafeAreaInsets();
  /** 有底部 Tab 时由 Tab 承担安全区，此处仅留少量呼吸间距 */
  const bottomPad = bottomInset ?? 8;
  const showContextSlot =
    reserveContextSlot || contextUsage !== undefined || contextUsageLoading;
  const { bodyFontSize, bodyLineHeight } = useLayout();
  const [mode, setMode] = useState<ComposeMode>('keyboard');
  const valueBeforeDictationRef = useRef('');

  useEffect(() => {
    void ensureSpeechPermissions();
  }, []);

  const handleDictationPartial = useCallback(
    (partial: string, opts: { replaceInterim: boolean }) => {
      if (opts.replaceInterim) {
        const prefix = valueBeforeDictationRef.current;
        onChangeText(prefix ? `${prefix}${partial}` : partial);
      } else {
        const prefix = valueBeforeDictationRef.current;
        onChangeText(prefix ? `${prefix}${partial}` : partial);
        valueBeforeDictationRef.current = prefix
          ? `${prefix}${partial}`
          : partial;
      }
    },
    [onChangeText],
  );

  const { dictating, toggle: toggleDictation, stop: stopDictation } = useInlineDictation(
    handleDictationPartial,
  );

  const { holding, transcribing, onPressIn, onPressOut } = useHoldToSpeak(
    useCallback(
      (text) => {
        if (onSendVoiceText) {
          onSendVoiceText(text);
        } else {
          onChangeText(text);
          onSend();
        }
      },
      [onChangeText, onSend, onSendVoiceText],
    ),
  );

  const canSend = Boolean(value.trim()) && !busy && !disabled;
  /** 键盘模式：有内容时用键盘「发送」，右侧不显示发送钮（保留 +） */
  const useKeyboardSend = mode === 'keyboard';

  const handleKeyboardSend = useCallback(() => {
    if (canSend) onSend();
  }, [canSend, onSend]);

  const contextControl =
    showContextSlot ? (
      <ContextUsageControl
        usage={contextUsage ?? null}
        loading={contextUsageLoading}
        reserveSlot={reserveContextSlot}
        onOpenDetail={onContextDetailOpen}
        onRingLongPress={onContextRingLongPress}
      />
    ) : null;

  const switchToVoice = useCallback(async () => {
    stopDictation();
    const ok = await ensureSpeechPermissions();
    if (!ok) {
      appAlert('需要权限', zh.chat.speechPermissionHint, [
        { text: '去设置', onPress: () => void Linking.openSettings() },
        { text: '知道了', style: 'cancel' },
      ]);
      return;
    }
    setMode('voice');
  }, [stopDictation]);

  const switchToKeyboard = useCallback(() => {
    setMode('keyboard');
  }, []);

  const handleToggleMode = useCallback(() => {
    if (mode === 'keyboard') {
      void switchToVoice();
    } else {
      switchToKeyboard();
    }
  }, [mode, switchToKeyboard, switchToVoice]);

  const handleDictationPress = useCallback(async () => {
    if (dictating) {
      stopDictation();
      return;
    }
    valueBeforeDictationRef.current = value;
    await toggleDictation();
  }, [dictating, stopDictation, toggleDictation, value]);

  const handlePickImage = useCallback(async () => {
    const asset = await pickAssistantOcrImage();
    if (asset && onPickImage) onPickImage(asset);
  }, [onPickImage]);

  return (
    <View style={styles.barOuter}>
    <View style={[styles.bar, { paddingBottom: bottomPad }]}>
      <Pressable
        style={styles.iconBtn}
        onPress={handleToggleMode}
        disabled={busy || disabled}
        accessibilityRole="button"
        accessibilityLabel={mode === 'keyboard' ? zh.chat.switchToVoice : zh.chat.switchToKeyboard}
      >
        <ChatUiIcon
          source={mode === 'keyboard' ? icons.voice : icons.keyboard}
          size={COMPOSE_ICON_SIZE}
        />
      </Pressable>

      <View style={styles.center}>
        <View style={[styles.fieldShell, askAiHighlight && styles.fieldShellAskAi]}>
          {mode === 'keyboard' ? (
            <>
              <AppTextInput
                ref={inputRef}
                variant="compose"
                style={[
                  styles.input,
                  { fontSize: bodyFontSize, lineHeight: bodyLineHeight },
                ]}
                placeholder={placeholder}
                placeholderTextColor={colors.textMuted}
                value={value}
                onChangeText={onChangeText}
                multiline
                scrollEnabled
                editable={!disabled && !busy && !dictating}
                autoCorrect={false}
                spellCheck={false}
                autoCapitalize="sentences"
                returnKeyType={useKeyboardSend ? 'send' : 'default'}
                submitBehavior={useKeyboardSend ? 'submit' : 'newline'}
                enablesReturnKeyAutomatically={useKeyboardSend}
                blurOnSubmit={false}
                onSubmitEditing={useKeyboardSend ? handleKeyboardSend : undefined}
              />
              <Pressable
                style={[styles.dictationBtn, dictating && styles.dictationBtnActive]}
                onPress={() => void handleDictationPress()}
                disabled={busy || disabled}
                hitSlop={4}
                accessibilityRole="button"
                accessibilityLabel={dictating ? zh.chat.stopDictation : zh.chat.startDictation}
              >
                <ChatUiIcon source={icons.dictation} size={COMPOSE_ICON_SIZE} active={dictating} />
              </Pressable>
            </>
          ) : (
            <Pressable
              style={[styles.holdArea, holding && styles.holdAreaActive]}
              onPressIn={() => void onPressIn()}
              onPressOut={onPressOut}
              disabled={busy || disabled}
            >
              <Text style={[styles.holdLabel, holding && styles.holdLabelActive]}>
                {transcribing
                  ? '正在转文字…'
                  : holding
                    ? zh.writing.releaseToFinish
                    : zh.writing.speak}
              </Text>
            </Pressable>
          )}
        </View>
      </View>

      {!contextAfterTrailing ? contextControl : null}

      {canSend && !useKeyboardSend ? (
        <Pressable
          style={[styles.sendBtn, sendVariant === 'askAi' && styles.sendBtnAskAi]}
          onPress={onSend}
          disabled={!canSend}
          accessibilityRole="button"
          accessibilityLabel={sendLabel ?? zh.chat.send}
        >
          {busy ? (
            <ActivityIndicator
              color={sendVariant === 'askAi' ? '#000000' : colors.onPrimary}
              size="small"
            />
          ) : (
            <Text
              style={[styles.sendBtnText, sendVariant === 'askAi' && styles.sendBtnTextAskAi]}
            >
              {sendLabel ?? zh.chat.send}
            </Text>
          )}
        </Pressable>
      ) : (
        <Pressable
          style={styles.iconBtn}
          onPress={() => void handlePickImage()}
          disabled={busy || disabled || !onPickImage}
          accessibilityRole="button"
          accessibilityLabel={zh.chat.pickImage}
        >
          <ChatUiIcon source={icons.plus} size={COMPOSE_ICON_SIZE} active={!busy && !disabled} />
        </Pressable>
      )}

      {contextAfterTrailing ? contextControl : null}
    </View>
    </View>
  );
}

const FIELD_HEIGHT = 40;

const styles = StyleSheet.create({
  barOuter: {
    borderWidth: 2,
    borderColor: 'transparent',
    borderRadius: 10,
    marginHorizontal: 4,
    marginTop: 2,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 6,
    paddingHorizontal: 10,
    paddingTop: 4,
    backgroundColor: wechat.navBg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: wechat.navBorder,
  },
  iconBtn: {
    width: 36,
    height: FIELD_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 0,
  },
  center: {
    flex: 1,
    minWidth: 0,
    minHeight: FIELD_HEIGHT,
    justifyContent: 'flex-end',
  },
  /** 键盘输入与按住说话共用外框，尺寸一致 */
  fieldShell: {
    flex: 1,
    minWidth: 0,
    minHeight: FIELD_HEIGHT,
    maxHeight: 120,
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: colors.surface,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  fieldShellAskAi: {
    borderWidth: 2,
    borderColor: ASK_AI_ORANGE,
    backgroundColor: 'rgba(255, 152, 0, 0.06)',
  },
  input: {
    paddingLeft: 10,
    paddingRight: 4,
    color: colors.text,
  },
  dictationBtn: {
    width: 32,
    height: 32,
    marginRight: 4,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  dictationBtnActive: {
    backgroundColor: colors.primarySoft,
  },
  holdArea: {
    flex: 1,
    minHeight: FIELD_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  holdAreaActive: {
    backgroundColor: colors.primarySoft,
  },
  holdLabel: {
    fontSize: typography.body,
    fontWeight: '600',
    color: colors.text,
  },
  holdLabelActive: {
    color: colors.primary,
  },
  sendBtn: {
    minWidth: 52,
    height: FIELD_HEIGHT,
    paddingHorizontal: 10,
    borderRadius: 6,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnText: {
    color: colors.onPrimary,
    fontWeight: '700',
    fontSize: typography.small,
  },
  sendBtnAskAi: {
    backgroundColor: '#4caf50',
  },
  sendBtnTextAskAi: {
    color: '#000000',
  },
});
