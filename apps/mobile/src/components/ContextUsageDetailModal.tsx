import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import type { ContextUsage } from '@xzz/shared';
import { formatTokenCount, getContextBreakdownSegments } from '@xzz/shared';
import { AppModalShell } from './AppModalShell';
import { colors, typography } from '../theme/colors';
import { zh } from '../locales/zh-CN';

type ContentProps = {
  usage: ContextUsage;
  cardStyle?: StyleProp<ViewStyle>;
};

/** 上下文详情卡片内容（可嵌在全屏 Modal 或小助手面板内） */
export function ContextUsageDetailContent({ usage, cardStyle }: ContentProps) {
  const percent = Math.round(usage.ratio * 100);
  const segments = getContextBreakdownSegments(usage.breakdown);
  const totalSegmentTokens = segments.reduce((s, seg) => s + seg.tokens, 0);

  return (
    <View style={[styles.card, cardStyle]}>
      <View style={styles.summaryRow}>
        <Text style={styles.percentText}>{zh.context.percentUsed(percent)}</Text>
        <Text style={styles.tokensText}>
          {zh.context.tokensSummary(
            formatTokenCount(usage.usedTokens),
            formatTokenCount(usage.limitTokens),
          )}
        </Text>
      </View>

      <View style={styles.segmentTrack}>
        {segments.map((seg) => {
          const widthPct =
            totalSegmentTokens > 0 ? (seg.tokens / totalSegmentTokens) * 100 : 0;
          return (
            <View
              key={seg.key}
              style={[styles.segment, { width: `${widthPct}%`, backgroundColor: seg.color }]}
            />
          );
        })}
      </View>

      <View style={styles.legend}>
        {segments.map((seg) => (
          <View key={seg.key} style={styles.legendRow}>
            <View style={styles.legendLeft}>
              <View style={[styles.swatch, { backgroundColor: seg.color }]} />
              <Text style={styles.legendLabel}>{seg.labelZh}</Text>
            </View>
            <Text style={styles.legendValue}>{formatTokenCount(seg.tokens)}</Text>
          </View>
        ))}
      </View>

      {usage.compacted ? <Text style={styles.hint}>{zh.context.compactedHint}</Text> : null}
    </View>
  );
}

type Props = {
  visible: boolean;
  usage: ContextUsage | null;
  onClose: () => void;
  /** 嵌在父容器内（如写作小助手浮层），不用全屏 Modal */
  inline?: boolean;
};

export function ContextUsageDetailModal({ visible, usage, onClose, inline }: Props) {
  if (!visible || !usage) return null;

  if (inline) {
    return (
      <Pressable
        style={styles.inlineCard}
        onPress={(e) => e.stopPropagation()}
        accessibilityViewIsModal
      >
        <View style={styles.inlineHeader}>
          <Text style={styles.inlineTitle}>{zh.context.detailTitle}</Text>
          <Pressable
            onPress={onClose}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={zh.context.close}
          >
            <Text style={styles.inlineClose}>✕</Text>
          </Pressable>
        </View>
        <ContextUsageDetailContent usage={usage} cardStyle={styles.inlineBody} />
      </Pressable>
    );
  }

  return (
    <AppModalShell
      visible={visible}
      title={zh.context.detailTitle}
      onClose={onClose}
      closeAccessibilityLabel={zh.context.close}
      cardStyle={styles.modalCard}
    >
      <ContextUsageDetailContent usage={usage} cardStyle={styles.modalBody} />
    </AppModalShell>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
  },
  modalCard: {
    maxWidth: 360,
    width: '92%',
  },
  modalBody: {
    borderWidth: 0,
    padding: 0,
    backgroundColor: 'transparent',
  },
  inlineCard: {
    width: '100%',
    maxWidth: 320,
    backgroundColor: colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 8,
  },
  inlineHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  inlineTitle: {
    fontSize: typography.body,
    fontWeight: '700',
    color: colors.text,
  },
  inlineClose: {
    fontSize: typography.body,
    color: colors.textMuted,
    paddingHorizontal: 4,
  },
  inlineBody: {
    borderWidth: 0,
    borderRadius: 0,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 12,
  },
  percentText: {
    fontSize: typography.body,
    fontWeight: '700',
    color: colors.text,
    flexShrink: 0,
  },
  tokensText: {
    fontSize: typography.small,
    fontWeight: '600',
    color: colors.textMuted,
    flexShrink: 1,
    textAlign: 'right',
  },
  segmentTrack: {
    flexDirection: 'row',
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
    backgroundColor: colors.border,
    marginBottom: 14,
  },
  segment: {
    height: '100%',
    minWidth: 2,
  },
  legend: {
    gap: 8,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  legendLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 1,
  },
  swatch: {
    width: 10,
    height: 10,
    borderRadius: 2,
  },
  legendLabel: {
    fontSize: typography.small,
    color: colors.text,
    fontWeight: '500',
  },
  legendValue: {
    fontSize: typography.small,
    color: colors.textMuted,
    fontWeight: '600',
    flexShrink: 0,
  },
  hint: {
    marginTop: 12,
    fontSize: typography.small,
    color: colors.textMuted,
    lineHeight: Math.round(typography.small * 1.45),
  },
});
