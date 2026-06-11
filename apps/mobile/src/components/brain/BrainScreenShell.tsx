import { useEffect, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BrainLogicHint } from '../../brain/logicHints';
import { zh } from '../../locales/zh-CN';
import { brainTokens } from '../../theme/brainTokens';
import { BrainLogicBanner } from './BrainLogicBanner';

type Props = {
  title: string;
  hint: BrainLogicHint;
  onBack?: () => void;
  loading?: boolean;
  error?: string | null;
  onReload?: () => void;
  children: ReactNode;
};

export function BrainScreenShell({
  title,
  hint,
  onBack,
  loading,
  error,
  onReload,
  children,
}: Props) {
  const insets = useSafeAreaInsets();
  // W2 防闪:记录「内容是否展示过」。聚焦重拉(loading 再变 true)时不再卸载 children
  // 整屏换 spinner —— 已有内容静默刷新,只有首载/出错才占屏。
  const [hasShownContent, setHasShownContent] = useState(false);
  useEffect(() => {
    if (!loading && !error) setHasShownContent(true);
  }, [loading, error]);
  const showFullLoader = loading && !hasShownContent;

  return (
    <View style={[styles.page, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        {onBack ? (
          <Pressable onPress={onBack} style={styles.backBtn} accessibilityRole="button">
            <Text style={styles.backText}>{zh.brain.actions.back}</Text>
          </Pressable>
        ) : (
          <View style={styles.backBtn} />
        )}
        <Text style={styles.headerTitle} numberOfLines={1}>
          {title}
        </Text>
        {onReload ? (
          <Pressable onPress={onReload} accessibilityRole="button">
            <Text style={styles.reload}>{zh.brain.actions.reload}</Text>
          </Pressable>
        ) : (
          <View style={styles.backBtn} />
        )}
      </View>

      <BrainLogicBanner hint={hint} />

      {showFullLoader ? (
        <ActivityIndicator color={brainTokens.accent} style={styles.loader} />
      ) : error ? (
        <Text style={styles.error}>{error}</Text>
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 16) + 24 }}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: brainTokens.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: brainTokens.borderSubtle,
  },
  backBtn: {
    width: 56,
  },
  backText: {
    color: brainTokens.accent,
    fontSize: 15,
  },
  reload: {
    color: brainTokens.info,
    fontSize: 13,
    width: 56,
    textAlign: 'right',
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    color: brainTokens.text,
    fontSize: 17,
    fontWeight: '700',
  },
  loader: { marginTop: 40 },
  error: {
    color: brainTokens.error,
    textAlign: 'center',
    marginTop: 24,
    paddingHorizontal: 16,
  },
});
