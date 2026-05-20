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
import { evaBrain } from '../theme/evaBrain';
import { zh } from '../locales/zh-CN';

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

const panelShadow = Platform.select({
  ios: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.42,
    shadowRadius: 14,
  },
  android: { elevation: 10 },
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
    backgroundColor: evaBrain.bgElevated,
    borderRadius: PANEL_RADIUS,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: evaBrain.border,
    overflow: 'hidden',
    ...panelShadow,
  },
  panelAccent: {
    position: 'absolute',
    top: 0,
    left: PANEL_RADIUS,
    right: PANEL_RADIUS,
    height: 2,
    backgroundColor: evaBrain.accent,
    opacity: 0.5,
    borderBottomLeftRadius: 1,
    borderBottomRightRadius: 1,
  },
  hint: {
    fontSize: 12,
    color: evaBrain.accentBright,
    marginTop: 10,
    marginBottom: 4,
    paddingHorizontal: 14,
    letterSpacing: 0.3,
  },
  scroll: {
    maxHeight: 260,
  },
  optionPressed: {
    backgroundColor: 'rgba(255, 140, 26, 0.08)',
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 9,
    minHeight: 40,
  },
  optionRowRecommended: {
    backgroundColor: 'rgba(255, 140, 26, 0.06)',
    borderLeftWidth: 2,
    borderLeftColor: evaBrain.accentBright,
    paddingLeft: 8,
  },
  optionIndex: {
    width: 28,
    fontSize: 12,
    fontFamily: evaBrain.mono,
    color: evaBrain.textDim,
    lineHeight: 18,
  },
  optionIndexHot: {
    color: evaBrain.accent,
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
    color: evaBrain.text,
    fontWeight: '600',
    lineHeight: 19,
  },
  optionLabelHot: {
    color: evaBrain.accentBright,
  },
  optionLabelMuted: {
    color: evaBrain.textMuted,
    fontWeight: '500',
  },
  optionBadge: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: evaBrain.accent,
    backgroundColor: 'rgba(255, 140, 26, 0.12)',
  },
  optionBadgeText: {
    fontSize: 10,
    color: evaBrain.accentBright,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  optionBadgeAgent: {
    borderColor: '#5a6cff',
    backgroundColor: 'rgba(90, 108, 255, 0.12)',
  },
  optionBadgeAgentText: {
    color: '#5a6cff',
  },
  optionDesc: {
    marginTop: 2,
    fontSize: 11,
    color: evaBrain.textMuted,
    lineHeight: 15,
  },
  optionChevron: {
    marginLeft: 4,
    fontSize: 18,
    color: evaBrain.textDim,
    fontWeight: '300',
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: evaBrain.borderSubtle,
    marginLeft: 38,
  },
});
