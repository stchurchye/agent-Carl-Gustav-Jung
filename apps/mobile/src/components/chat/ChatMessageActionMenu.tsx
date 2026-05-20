import { useMemo, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { MessageBubbleAnchor } from './MessageBubbleAnchor';
import {
  computeMessageActionMenuLayout,
  MESSAGE_ACTION_MENU_METRICS,
  type RectAnchor,
} from '../../lib/messageActionMenuLayout';
import type { MessageActionViewport } from '../../hooks/useMessageActionViewport';
import { zh } from '../../locales/zh-CN';

const M = MESSAGE_ACTION_MENU_METRICS;

type Props = {
  visible: boolean;
  anchor: MessageBubbleAnchor | null;
  viewport: MessageActionViewport | null;
  composeRect: RectAnchor | null;
  canCopy: boolean;
  canMark: boolean;
  canRemember?: boolean;
  markActive: boolean;
  busy?: boolean;
  onClose: () => void;
  onCopy: () => void;
  onMark: () => void;
  onCancelMark: () => void;
  onRemember?: () => void;
};

function CopyIcon() {
  return (
    <View style={styles.iconBox}>
      <View style={[styles.copyBack, styles.copyRect]} />
      <View style={[styles.copyFront, styles.copyRect]} />
    </View>
  );
}

function MarkIcon({ active }: { active: boolean }) {
  return (
    <View style={styles.iconBox}>
      <View style={[styles.markPin, active && styles.markPinActive]} />
      <View style={[styles.markFlag, active && styles.markFlagActive]} />
    </View>
  );
}

function MenuItem({
  label,
  icon,
  onPress,
  disabled,
  loading,
}: {
  label: string;
  icon: ReactNode;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.item,
        pressed && !disabled && styles.itemPressed,
        disabled && styles.itemDisabled,
      ]}
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {loading ? <ActivityIndicator color="#fff" size="small" /> : icon}
      <Text style={styles.itemLabel}>{label}</Text>
    </Pressable>
  );
}

export function ChatMessageActionMenu({
  visible,
  anchor,
  viewport,
  composeRect,
  canCopy,
  canMark,
  canRemember = false,
  markActive,
  busy,
  onClose,
  onCopy,
  onMark,
  onCancelMark,
  onRemember,
}: Props) {
  const layout = useMemo(() => {
    if (!anchor || !viewport || !composeRect) return null;
    const itemCount =
      (canCopy ? 1 : 0) + (canMark ? 1 : 0) + (canRemember ? 1 : 0);
    const { width, height } = Dimensions.get('window');
    return computeMessageActionMenuLayout({
      anchor,
      viewport,
      compose: composeRect,
      itemCount,
      screen: { width, height },
    });
  }, [anchor, viewport, composeRect, canCopy, canMark, canRemember]);

  if (!visible || !anchor || !layout) return null;

  const markLabel = markActive ? zh.chat.messageActionUnmark : zh.chat.messageActionMark;

  return (
    <View style={styles.host} pointerEvents="box-none">
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" />
      <View
        style={[
          styles.menu,
          {
            left: layout.left,
            top: layout.top,
            width: layout.menuWidth,
            minHeight: layout.menuHeight,
          },
        ]}
        pointerEvents="box-none"
      >
        <View style={styles.row}>
          {canCopy ? (
            <MenuItem
              label={zh.chat.messageActionCopy}
              icon={<CopyIcon />}
              onPress={onCopy}
              disabled={busy}
            />
          ) : null}
          {canMark ? (
            <MenuItem
              label={markLabel}
              icon={<MarkIcon active={markActive} />}
              onPress={markActive ? onCancelMark : onMark}
              disabled={busy}
              loading={busy}
            />
          ) : null}
          {canRemember && onRemember ? (
            <MenuItem
              label={zh.intent.rememberMessage}
              icon={<Text style={styles.rememberIcon}>★</Text>}
              onPress={onRemember}
              disabled={busy}
            />
          ) : null}
        </View>
        <View
          style={[
            layout.arrowAtTop ? styles.arrowUp : styles.arrowDown,
            { left: layout.arrowLeft },
          ]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 50,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'transparent',
  },
  menu: {
    position: 'absolute',
    backgroundColor: 'rgba(76, 76, 76, 0.96)',
    borderRadius: 6,
    paddingHorizontal: M.padH,
    paddingTop: 8,
    paddingBottom: 9,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  item: {
    width: M.itemWidth,
    alignItems: 'center',
    paddingVertical: 2,
    gap: 4,
  },
  itemPressed: {
    opacity: 0.75,
  },
  itemDisabled: {
    opacity: 0.4,
  },
  itemLabel: {
    fontSize: 11,
    color: '#FFFFFF',
    fontWeight: '500',
  },
  arrowDown: {
    position: 'absolute',
    bottom: -M.arrow + 1,
    width: 0,
    height: 0,
    borderLeftWidth: M.arrow,
    borderRightWidth: M.arrow,
    borderTopWidth: M.arrow,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: 'rgba(76, 76, 76, 0.96)',
  },
  arrowUp: {
    position: 'absolute',
    top: -M.arrow + 1,
    width: 0,
    height: 0,
    borderLeftWidth: M.arrow,
    borderRightWidth: M.arrow,
    borderBottomWidth: M.arrow,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: 'rgba(76, 76, 76, 0.96)',
  },
  iconBox: {
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copyRect: {
    position: 'absolute',
    width: 12,
    height: 14,
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
    borderRadius: 2,
    backgroundColor: 'transparent',
  },
  copyBack: {
    top: 2,
    left: 5,
    opacity: 0.55,
  },
  copyFront: {
    top: 5,
    left: 2,
  },
  markPin: {
    position: 'absolute',
    bottom: 2,
    width: 2,
    height: 7,
    backgroundColor: '#FFFFFF',
    borderRadius: 1,
  },
  markPinActive: {
    backgroundColor: '#FFCDD2',
  },
  markFlag: {
    position: 'absolute',
    top: 3,
    left: 8,
    width: 9,
    height: 7,
    borderTopWidth: 1.5,
    borderRightWidth: 1.5,
    borderColor: '#FFFFFF',
    borderTopRightRadius: 2,
  },
  markFlagActive: {
    borderColor: '#FFCDD2',
  },
  rememberIcon: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
});
