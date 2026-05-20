import { StyleSheet } from 'react-native';
import { colors } from './colors';
import { radius, touch } from './tokens';
import { wechat } from './wechat';

/** 居中卡片弹窗、右侧浮层共用的样式片段 */
export const modalStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: colors.backdrop,
    justifyContent: 'center',
    padding: 28,
  },
  backdropFill: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.backdrop,
  },
  card: {
    backgroundColor: wechat.cellBg,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  cardCentered: {
    maxHeight: '92%',
    width: '100%',
  },
  /** 应用内 Alert / Prompt 提示框 */
  alertBackdrop: {
    flex: 1,
    backgroundColor: colors.backdrop,
    justifyContent: 'center',
    paddingVertical: 20,
    paddingHorizontal: 28,
  },
  alertCard: {
    alignSelf: 'center',
    width: '100%',
    maxWidth: 560,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  headerBordered: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 0,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: wechat.separator,
    backgroundColor: wechat.cellBg,
  },
  title: {
    flex: 1,
    fontWeight: '700',
    color: colors.text,
  },
  closeBtn: {
    minWidth: touch.min,
    minHeight: touch.min,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: {
    color: colors.textMuted,
    fontWeight: '600',
  },
  sheet: {
    flex: 1,
    backgroundColor: wechat.cellBg,
    borderTopLeftRadius: radius.md,
    borderBottomLeftRadius: radius.md,
    overflow: 'hidden',
    elevation: 8,
  },
  actionRow: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: wechat.separator,
  },
  actionBtn: {
    flex: 1,
    minHeight: touch.min,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
  },
  actionBtnText: {
    fontSize: 17,
    color: colors.primary,
    fontWeight: '400',
  },
  actionBtnCancel: {
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: wechat.separator,
  },
  actionBtnCancelText: {
    color: wechat.textPrimary,
  },
});
