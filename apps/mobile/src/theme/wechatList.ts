import { StyleSheet } from 'react-native';
import { wechat } from './wechat';
import { typography } from './colors';

export const wechatListStyles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: wechat.pageBg,
  },
  groupWrap: {
    marginBottom: wechat.groupGap,
  },
  groupHeader: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 6,
  },
  groupHeaderText: {
    fontSize: wechat.footerHintSize,
    color: wechat.textSecondary,
  },
  groupCard: {
    backgroundColor: wechat.cellBg,
    overflow: 'hidden',
  },
  cell: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: wechat.rowMinHeight,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: wechat.cellBg,
  },
  cellPressable: {
    minHeight: wechat.rowMinHeight,
  },
  cellLabel: {
    flex: 1,
    fontSize: wechat.listTitleSize,
    color: wechat.textPrimary,
  },
  cellValue: {
    fontSize: typography.caption,
    color: wechat.textSecondary,
    marginRight: 4,
    maxWidth: '50%',
    textAlign: 'right',
  },
  cellChevron: {
    fontSize: 18,
    color: '#C7C7CC',
    fontWeight: '300',
    marginLeft: 2,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: wechat.separator,
    marginLeft: wechat.separatorInset,
  },
  separatorInsetAvatar: {
    marginLeft: wechat.separatorInsetWithAvatar,
  },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
  },
  footerText: {
    fontSize: wechat.footerHintSize,
    lineHeight: 18,
    color: wechat.textSecondary,
  },
  logoutCell: {
    minHeight: wechat.rowMinHeight,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: wechat.cellBg,
  },
  logoutText: {
    fontSize: wechat.listTitleSize,
    color: '#E64340',
    fontWeight: '400',
  },
});
