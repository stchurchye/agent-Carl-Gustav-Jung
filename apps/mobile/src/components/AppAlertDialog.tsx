import { useMemo } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { personaAssistantDisplayName, presetDogForSeed } from '@xzz/shared';
import { wechat } from '../theme/wechat';
import { colors } from '../theme/colors';
import { modalStyles } from '../theme/modalStyles';
import { radius, touch } from '../theme/tokens';
import { useTextStyles } from '../theme/useTextStyles';
import type { AppAlertButton } from '../lib/appAlert';
import { usePersona } from '../hooks/usePersona';
import { PixelCharacter } from './pixel/PixelCharacter';
import { buildDogCharacter } from '../pixel/buildDog';
import { buildCatCharacter } from '../pixel/buildCat';
import { PERSONALITY_MOTION } from '../pixel/palette';

type Props = {
  visible: boolean;
  title: string;
  message?: string;
  buttons: AppAlertButton[];
  onDismiss: () => void;
};

export function AppAlertDialog({ visible, title, message, buttons, onDismiss }: Props) {
  const text = useTextStyles();
  const rowButtons = buttons.length === 2;

  // 用「会动的狗 + 狗名 + 对你的称呼」给提示窗一个人性化的狗狗口吻(响应式读共享 persona 缓存)
  const { persona, avatar: snapAvatar } = usePersona();
  const { char: petChar, personality: petPersonality } = useMemo(() => {
    if (snapAvatar?.species === 'cat' && snapAvatar.cat) {
      return { char: buildCatCharacter(snapAvatar.cat), personality: snapAvatar.cat.personality };
    }
    const dog = snapAvatar?.dog ?? presetDogForSeed('bowwow').dog;
    return { char: buildDogCharacter(dog), personality: dog.personality };
  }, [snapAvatar]);
  const dogName = personaAssistantDisplayName(persona ?? undefined);
  const callMe = persona?.user?.preferredName ?? '';
  const spokenMessage = message && callMe ? `${callMe}，${message}` : message;

  const runButton = (btn: AppAlertButton) => {
    onDismiss();
    btn.onPress?.();
  };

  const onRequestClose = () => {
    const cancel = buttons.find((b) => b.style === 'cancel');
    if (cancel) runButton(cancel);
    else onDismiss();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onRequestClose}
      presentationStyle="overFullScreen"
    >
      <View style={modalStyles.alertBackdrop}>
        <View style={[modalStyles.card, modalStyles.alertCard, styles.card]}>
          <View style={styles.speaker}>
            <PixelCharacter
              character={petChar}
              size={52}
              motion={PERSONALITY_MOTION[petPersonality]}
              animated
            />
            <Text style={[text.caption, styles.dogName]}>{dogName}</Text>
          </View>
          <Text style={[text.title, styles.title]}>{title}</Text>
          {spokenMessage ? (
            <Text style={[text.body, styles.message]}>{spokenMessage}</Text>
          ) : null}
          <View style={[styles.btnRow, rowButtons ? styles.btnRowHorizontal : styles.btnRowVertical]}>
            {buttons.map((btn, i) => {
              const destructive = btn.style === 'destructive';
              return (
                <Pressable
                  key={`${btn.text}-${i}`}
                  style={({ pressed }) => [
                    styles.btn,
                    rowButtons && styles.btnFlex,
                    pressed && styles.btnPressed,
                  ]}
                  onPress={() => runButton(btn)}
                  accessibilityRole="button"
                >
                  <Text
                    style={[
                      text.button,
                      styles.btnLabel,
                      destructive && styles.btnLabelDestructive,
                    ]}
                  >
                    {btn.text}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  card: {
    paddingHorizontal: 0,
    paddingTop: 20,
    paddingBottom: 0,
    borderRadius: radius.md,
  },
  speaker: {
    alignItems: 'center',
    marginBottom: 10,
    gap: 2,
  },
  dogName: {
    color: colors.textMuted,
    fontWeight: '600',
  },
  title: {
    textAlign: 'center',
    marginBottom: 12,
    paddingHorizontal: 24,
  },
  message: {
    textAlign: 'center',
    color: colors.textMuted,
    marginBottom: 20,
    paddingHorizontal: 24,
  },
  btnRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  btnRowHorizontal: {
    flexDirection: 'row',
  },
  btnRowVertical: {
    flexDirection: 'column',
  },
  btn: {
    minHeight: touch.min,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 0,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnFlex: {
    flex: 1,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: wechat.separator,
  },
  btnPressed: {
    opacity: 0.85,
  },
  btnLabel: {
    textAlign: 'center',
    color: colors.primary,
    fontWeight: '400',
  },
  btnLabelDestructive: {
    color: colors.error,
  },
});
