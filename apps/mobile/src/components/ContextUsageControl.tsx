import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { ContextUsage } from '@xzz/shared';
import { ContextUsageDetailModal } from './ContextUsageDetailModal';
import { ContextUsageRing } from './ContextUsageRing';
import { zh } from '../locales/zh-CN';

const SLOT_SIZE = 36;

type Props = {
  usage: ContextUsage | null;
  loading?: boolean;
  /** 占位，避免异步加载时挤压输入栏布局 */
  reserveSlot?: boolean;
  /** 由父级在小助手面板内展示详情（不用全屏居中 Modal） */
  onOpenDetail?: (usage: ContextUsage) => void;
  onRingLongPress?: () => void;
};

export function ContextUsageControl({
  usage,
  loading,
  reserveSlot,
  onOpenDetail,
  onRingLongPress,
}: Props) {
  const [detailOpen, setDetailOpen] = useState(false);

  if (!usage && !loading && !reserveSlot) return null;

  if (!usage && !loading) {
    return <View style={styles.slot} pointerEvents="none" />;
  }

  const ratio = usage?.ratio ?? 0;
  const accessibilityLabel = loading
    ? zh.context.usageLoading
    : zh.context.ringAccessibility;

  const openDetail = () => {
    if (!usage) return;
    if (onOpenDetail) {
      onOpenDetail(usage);
    } else {
      setDetailOpen(true);
    }
  };

  return (
    <>
      <View style={styles.slot} pointerEvents="box-none">
        <ContextUsageRing
          ratio={ratio}
          loading={loading}
          onPress={openDetail}
          onLongPress={onRingLongPress}
          accessibilityLabel={
            onRingLongPress ? zh.context.ringLongPressAccessibility : accessibilityLabel
          }
        />
      </View>
      {!onOpenDetail && detailOpen && usage ? (
        <ContextUsageDetailModal
          visible
          usage={usage}
          onClose={() => setDetailOpen(false)}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  slot: {
    width: SLOT_SIZE,
    height: 40,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
});
