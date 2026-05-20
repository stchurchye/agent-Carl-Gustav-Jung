import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { ContextPreviewBlock } from '@xzz/shared';
import { formatLlmExcludeMarkers, formatTokenCount } from '@xzz/shared';
import { colors, typography } from '../theme/colors';
import { zh } from '../locales/zh-CN';

type Props = {
  block: ContextPreviewBlock;
  selected: boolean;
  onToggle: () => void;
};

export function ContextPreviewBlockRow({ block, selected, onToggle }: Props) {
  const [expanded, setExpanded] = useState(false);
  const omitted = block.omittedByBudget === true;
  const markedActive = block.llmExclude?.active === true;
  const everCanceled =
    block.llmExclude?.everCanceled === true && !block.llmExclude?.active;
  const disabled = !block.selectable || omitted || markedActive;

  return (
    <View
      style={[
        styles.row,
        block.kind === 'pending_user' && styles.rowPending,
        omitted && styles.rowOmitted,
        markedActive && styles.rowMarked,
      ]}
    >
      <Pressable
        style={styles.header}
        onPress={() => setExpanded((v) => !v)}
        accessibilityRole="button"
      >
        {block.selectable ? (
          <Pressable
            style={[styles.checkbox, selected && styles.checkboxOn, disabled && styles.checkboxDisabled]}
            onPress={() => {
              if (!disabled) onToggle();
            }}
            hitSlop={8}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: selected, disabled }}
          >
            {selected ? <Text style={styles.checkMark}>✓</Text> : null}
          </Pressable>
        ) : (
          <View style={styles.checkboxSpacer} />
        )}
        <View style={styles.headerText}>
          <Text style={[styles.label, omitted && styles.labelMuted]} numberOfLines={1}>
            {block.label}
            {omitted ? ` · ${zh.context.omittedByBudget}` : ''}
            {markedActive && block.llmExclude
              ? ` · ${zh.writing.llmExcludeMarkedActive}`
              : ''}
            {everCanceled ? ` · ${zh.writing.llmExcludeEverCanceled}` : ''}
          </Text>
          {markedActive && block.llmExclude?.markers.length ? (
            <Text style={styles.markSub} numberOfLines={1}>
              {formatLlmExcludeMarkers(block.llmExclude)}
            </Text>
          ) : null}
          <Text style={styles.tokens}>{formatTokenCount(block.tokens)}</Text>
        </View>
        <Text style={styles.chevron}>{expanded ? '▾' : '▸'}</Text>
      </Pressable>
      {expanded ? (
        <Text style={[styles.content, omitted && styles.contentMuted]} selectable>
          {block.content}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    marginBottom: 8,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  rowPending: {
    borderColor: colors.insertBorder,
    backgroundColor: colors.insertBg,
  },
  rowOmitted: {
    opacity: 0.55,
  },
  rowMarked: {
    borderColor: 'rgba(244, 67, 54, 0.4)',
    backgroundColor: 'rgba(244, 67, 54, 0.06)',
  },
  markSub: {
    marginTop: 2,
    fontSize: typography.caption,
    color: colors.error,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 10,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  checkboxOn: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  checkboxDisabled: {
    opacity: 0.4,
  },
  checkboxSpacer: {
    width: 22,
    marginRight: 10,
  },
  checkMark: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  label: {
    fontSize: typography.body,
    fontWeight: '600',
    color: colors.text,
  },
  labelMuted: {
    color: colors.textMuted,
  },
  tokens: {
    marginTop: 2,
    fontSize: typography.caption,
    color: colors.textMuted,
  },
  chevron: {
    marginLeft: 8,
    fontSize: 12,
    color: colors.textMuted,
  },
  content: {
    paddingHorizontal: 12,
    paddingBottom: 12,
    fontSize: typography.caption,
    color: colors.text,
    lineHeight: 20,
  },
  contentMuted: {
    color: colors.textMuted,
  },
});
