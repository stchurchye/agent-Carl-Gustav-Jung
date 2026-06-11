import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type {
  IntentAnalyzeResult,
  IntentCandidate,
  IntentKind,
  MemoryIntentSlots,
  MemoryTargetCandidate,
} from '@xzz/shared';
import { intentHintMessage } from '../lib/intentFlow';
import { zh } from '../locales/zh-CN';

/**
 * 意图条聊天屏专属**亮色 chip 令牌**(P1.3)。
 * 不复用 brain 遗存暗系:浮层走干净白底 + 微信分隔灰 + 品牌橙弱底强调;
 * agent_run 用微信蓝(#576B95)区分,而非刺眼霓虹紫。退役 EVA 亮橙(255,140,26)不再出现。
 */
const intentChip = {
  panelBg: '#FFFFFF',
  border: '#E5E5E5',
  borderSubtle: 'rgba(229, 229, 229, 0.6)',
  accent: '#C15F3C', // 赤陶(与全局 primary 一致)
  accentTintSoft: 'rgba(193, 95, 60, 0.06)', // 推荐行弱底
  accentTintStrong: 'rgba(193, 95, 60, 0.12)', // 推荐 badge 底
  accentPressed: 'rgba(193, 95, 60, 0.08)', // 按压态
  textPrimary: '#1F1E1D',
  textSecondary: '#888888',
  textTertiary: '#B2B2B2',
  agentAccent: '#576B95', // agent_run 用微信蓝区分
  agentTint: 'rgba(87, 107, 149, 0.12)',
  mono: 'Menlo',
} as const;

type Props = {
  analyze: IntentAnalyzeResult;
  onSelectIntent: (kind: IntentKind, slots?: MemoryIntentSlots) => void;
  onSelectMemoryTarget: (fragmentId: string, kind: IntentKind) => void;
  onDismiss: () => void;
};

function candidateKey(c: IntentCandidate): string {
  return `${c.kind}:${c.label}:${c.slots?.navigateTarget ?? ''}`;
}

function isRecommendedCandidate(
  c: IntentCandidate,
  analyze: IntentAnalyzeResult,
  index: number,
): boolean {
  const top = analyze.candidates[0];
  if (!top || index !== 0) return false;
  return c.kind === analyze.suggested && candidateKey(c) === candidateKey(top);
}

function navigateHint(analyze: IntentAnalyzeResult): boolean {
  return (
    analyze.suggested === 'app_navigate' ||
    analyze.candidates.some((c) => c.kind === 'app_navigate')
  );
}

type OptionRowProps = {
  index?: number;
  label: string;
  description?: string;
  recommended?: boolean;
  muted?: boolean;
  /** agent_run 候选用不同 accent，提示是后台多步任务而非普通问答。 */
  agentRun?: boolean;
  onPress: () => void;
  showSeparator: boolean;
};

function OptionRow({
  index,
  label,
  description,
  recommended,
  muted,
  agentRun,
  onPress,
  showSeparator,
}: OptionRowProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => pressed && styles.optionPressed}
    >
      <View style={[styles.optionRow, recommended && styles.optionRowRecommended]}>
        {index != null ? (
          <Text style={[styles.optionIndex, recommended && styles.optionIndexHot]}>
            {String(index).padStart(2, '0')}
          </Text>
        ) : (
          <View style={styles.optionIndexSpacer} />
        )}
        <View style={styles.optionBody}>
          <View style={styles.optionTitleLine}>
            <Text
              style={[
                styles.optionLabel,
                recommended && styles.optionLabelHot,
                muted && styles.optionLabelMuted,
              ]}
              numberOfLines={2}
            >
              {label}
            </Text>
            {recommended ? (
              <View style={styles.optionBadge}>
                <Text style={styles.optionBadgeText}>{zh.intent.recommended}</Text>
              </View>
            ) : null}
            {agentRun ? (
              <View style={[styles.optionBadge, styles.optionBadgeAgent]}>
                <Text style={[styles.optionBadgeText, styles.optionBadgeAgentText]}>AGENT</Text>
              </View>
            ) : null}
          </View>
          {description ? (
            <Text style={styles.optionDesc} numberOfLines={2}>
              {description}
            </Text>
          ) : null}
        </View>
        <Text style={styles.optionChevron}>›</Text>
      </View>
      {showSeparator ? <View style={styles.separator} /> : null}
    </Pressable>
  );
}

export function IntentChipBar({
  analyze,
  onSelectIntent,
  onSelectMemoryTarget,
  onDismiss,
}: Props) {
  const showMemoryTargets =
    (analyze.suggested === 'memory_correct' ||
      analyze.suggested === 'memory_forget') &&
    (analyze.memoryTargets?.length ?? 0) > 0;

  const hint = intentHintMessage(analyze.hint);
  const hintText =
    hint ??
    (showMemoryTargets
      ? zh.intent.pickMemory
      : navigateHint(analyze) || analyze.suggested === 'persona_open_settings'
        ? zh.intent.pickNavigate
        : zh.intent.pickAction);

  const optionCount = showMemoryTargets
    ? (analyze.memoryTargets?.length ?? 0)
    : analyze.candidates.length;

  const renderCandidates = () => {
    if (showMemoryTargets) {
      const targets = analyze.memoryTargets!;
      return targets.map((t: MemoryTargetCandidate, i: number) => (
        <OptionRow
          key={t.fragmentId}
          index={i + 1}
          label={t.label}
          description={t.contentPreview}
          recommended={i === 0}
          showSeparator
          onPress={() => onSelectMemoryTarget(t.fragmentId, analyze.suggested)}
        />
      ));
    }

    return analyze.candidates.map((c, i) => (
      <OptionRow
        key={`${c.kind}-${c.label}-${c.slots?.navigateTarget ?? ''}-${i}`}
        index={i + 1}
        label={c.label}
        description={c.description}
        recommended={isRecommendedCandidate(c, analyze, i)}
        agentRun={c.kind === 'agent_run'}
        showSeparator
        onPress={() => onSelectIntent(c.kind, c.slots)}
      />
    ));
  };

  const options = (
    <>
      {renderCandidates()}
      <OptionRow
        key="cancel"
        index={optionCount + 1}
        label={zh.intent.cancel}
        muted
        showSeparator={false}
        onPress={onDismiss}
      />
    </>
  );

  const needsScroll = optionCount > 5;

  return (
    <View style={styles.wrap}>
      <View style={styles.panel}>
        <View style={styles.panelAccent} />
        <Text style={styles.hint}>{hintText}</Text>
        {needsScroll ? (
          <ScrollView
            style={styles.scroll}
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled
            showsVerticalScrollIndicator={false}
          >
            {options}
          </ScrollView>
        ) : (
          options
        )}
      </View>
    </View>
  );
}

const FLOAT_INSET = 20;
const PANEL_RADIUS = 16;

// 亮色浮层用克制阴影(原 0.42 黑阴影为暗主题调,白底上过重)。
const panelShadow = Platform.select({
  ios: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
  },
  android: { elevation: 4 },
  default: {},
});

const styles = StyleSheet.create({
  wrap: {
    paddingTop: 10,
    paddingBottom: 12,
    paddingHorizontal: FLOAT_INSET,
    backgroundColor: 'transparent',
  },
  panel: {
    backgroundColor: intentChip.panelBg,
    borderRadius: PANEL_RADIUS,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: intentChip.border,
    overflow: 'hidden',
    ...panelShadow,
  },
  panelAccent: {
    position: 'absolute',
    top: 0,
    left: PANEL_RADIUS,
    right: PANEL_RADIUS,
    height: 2,
    backgroundColor: intentChip.accent,
    opacity: 0.5,
    borderBottomLeftRadius: 1,
    borderBottomRightRadius: 1,
  },
  hint: {
    fontSize: 12,
    color: intentChip.accent,
    marginTop: 10,
    marginBottom: 4,
    paddingHorizontal: 14,
    letterSpacing: 0.3,
  },
  scroll: {
    maxHeight: 260,
  },
  optionPressed: {
    backgroundColor: intentChip.accentPressed,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 9,
    minHeight: 40,
  },
  optionRowRecommended: {
    backgroundColor: intentChip.accentTintSoft,
    borderLeftWidth: 2,
    borderLeftColor: intentChip.accent,
    paddingLeft: 8,
  },
  optionIndex: {
    width: 28,
    fontSize: 12,
    fontFamily: intentChip.mono,
    color: intentChip.textTertiary,
    lineHeight: 18,
  },
  optionIndexHot: {
    color: intentChip.accent,
  },
  optionIndexSpacer: {
    width: 28,
  },
  optionBody: {
    flex: 1,
    minWidth: 0,
  },
  optionTitleLine: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  optionLabel: {
    flexShrink: 1,
    fontSize: 14,
    color: intentChip.textPrimary,
    fontWeight: '600',
    lineHeight: 19,
  },
  optionLabelHot: {
    color: intentChip.accent,
  },
  optionLabelMuted: {
    color: intentChip.textSecondary,
    fontWeight: '500',
  },
  optionBadge: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: intentChip.accent,
    backgroundColor: intentChip.accentTintStrong,
  },
  optionBadgeText: {
    fontSize: 10,
    color: intentChip.accent,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  optionBadgeAgent: {
    borderColor: intentChip.agentAccent,
    backgroundColor: intentChip.agentTint,
  },
  optionBadgeAgentText: {
    color: intentChip.agentAccent,
  },
  optionDesc: {
    marginTop: 2,
    fontSize: 11,
    color: intentChip.textSecondary,
    lineHeight: 15,
  },
  optionChevron: {
    marginLeft: 4,
    fontSize: 18,
    color: intentChip.textTertiary,
    fontWeight: '300',
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: intentChip.borderSubtle,
    marginLeft: 38,
  },
});
