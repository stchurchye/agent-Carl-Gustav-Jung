import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WeChatChatHeader } from '../components/WeChatChatHeader';
import { WeChatGroupedSection } from '../components/wechat/WeChatGroupedSection';
import { WeChatListCell } from '../components/wechat/WeChatListCell';
import {
  BARK_COUNT,
  getCuesEnabled,
  getPreferredBark,
  loadCuesEnabled,
  loadPreferredBark,
  previewBark,
  setCuesEnabled,
  setPreferredBark,
} from '../lib/soundCues';
import { wechatChatStyles } from '../theme/wechatChat';
import { colors, typography } from '../theme/colors';
import { zh } from '../locales/zh-CN';

export function SettingsDogSoundScreen() {
  const insets = useSafeAreaInsets();
  const [cuesOn, setCuesOn] = useState(getCuesEnabled());
  const [preferred, setPreferred] = useState<number | null>(getPreferredBark());

  useFocusEffect(
    useCallback(() => {
      void Promise.all([loadCuesEnabled(), loadPreferredBark()]).then(([on, pref]) => {
        setCuesOn(on);
        setPreferred(pref);
      });
    }, []),
  );

  const toggle = (v: boolean) => {
    setCuesOn(v);
    void setCuesEnabled(v);
  };

  const selectStyle = (index: number | null) => {
    setPreferred(index);
    void setPreferredBark(index);
    if (index !== null) previewBark(index);
    else previewBark(0);
  };

  const styleOptions: Array<{ index: number | null; label: string }> = [
    { index: null, label: zh.me.dogSoundStyleAuto },
    ...Array.from({ length: BARK_COUNT }, (_, i) => ({
      index: i,
      label: zh.me.dogSoundStyleItems[i] ?? `汪 ${i + 1}`,
    })),
  ];

  return (
    <View style={wechatChatStyles.page}>
      <WeChatChatHeader title={zh.me.dogSoundTitle} showBack />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: Math.max(insets.bottom, 16) },
        ]}
      >
        <WeChatGroupedSection>
          <WeChatListCell
            label={zh.me.dogSoundCuesLabel}
            switchValue={cuesOn}
            onSwitchChange={toggle}
          />
        </WeChatGroupedSection>
        <Text style={styles.hint}>{zh.me.dogSoundCuesHint}</Text>

        <WeChatGroupedSection
          title={zh.me.dogSoundStyleSection}
          footer={preferred === null ? zh.me.dogSoundStyleAutoHint : undefined}
        >
          {styleOptions.map(({ index, label }, pos) => (
            <WeChatListCell
              key={String(index)}
              label={label}
              showSeparator={pos < styleOptions.length - 1}
              right={
                <View style={styles.rowRight}>
                  {preferred === index ? (
                    <Text style={styles.checkmark}>✓</Text>
                  ) : (
                    <Pressable
                      onPress={() => previewBark(index ?? 0)}
                      hitSlop={8}
                      style={({ pressed }) => [styles.previewBtn, pressed && styles.previewBtnPressed]}
                    >
                      <Text style={styles.previewText}>{zh.me.dogSoundStylePreview}</Text>
                    </Pressable>
                  )}
                </View>
              }
              onPress={() => selectStyle(index)}
            />
          ))}
        </WeChatGroupedSection>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: 16, paddingHorizontal: 16 },
  hint: {
    marginTop: 8,
    marginBottom: 8,
    fontSize: typography.small,
    color: colors.textMuted,
    lineHeight: Math.round(typography.small * 1.5),
    paddingHorizontal: 4,
  },
  rowRight: {
    marginLeft: 8,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 48,
  },
  checkmark: {
    fontSize: 18,
    color: colors.accent,
    fontWeight: '600',
  },
  previewBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  previewBtnPressed: { opacity: 0.5 },
  previewText: {
    fontSize: typography.small,
    color: colors.textMuted,
  },
});
