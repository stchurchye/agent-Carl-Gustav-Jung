import { StyleSheet } from 'react-native';
import { typography } from './colors';
import { wechat, wechatChat } from './wechat';

export { wechat, wechatChat };

export const wechatChatStyles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: wechat.pageBg,
  },
  listContent: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    paddingBottom: 20,
  },
  timestampWrap: {
    alignItems: 'center',
    marginVertical: 8,
  },
  timestamp: {
    fontSize: typography.small,
    color: wechat.timeLabel,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 10,
    maxWidth: '100%',
  },
  rowSelf: {
    flexDirection: 'row-reverse',
  },
  avatarSlot: {
    width: wechat.avatarSize,
    flexShrink: 0,
  },
  body: {
    flexGrow: 0,
    flexShrink: 1,
    maxWidth: wechat.bubbleMaxWidth,
    marginHorizontal: 6,
  },
  bodySelf: {
    alignItems: 'flex-end',
  },
  bodyOther: {
    alignItems: 'flex-start',
  },
  senderName: {
    fontSize: typography.small,
    color: wechat.senderName,
    marginBottom: 2,
    marginLeft: 2,
  },
  bubble: {
    borderRadius: wechat.bubbleRadius,
    paddingHorizontal: wechat.bubblePadH,
    paddingVertical: wechat.bubblePadV,
    maxWidth: '100%',
    flexGrow: 0,
    flexShrink: 1,
  },
  bubbleSelf: {
    backgroundColor: wechat.bubbleSelf,
  },
  bubbleOther: {
    backgroundColor: wechat.bubbleOther,
  },
  bubbleText: {
    fontSize: wechat.chatFontSize,
    lineHeight: wechat.chatLineHeight,
    color: wechat.bubbleText,
  },
  systemWrap: {
    width: '100%',
    marginBottom: 12,
    alignItems: 'center',
  },
  systemBubble: {
    maxWidth: '88%',
    backgroundColor: 'rgba(255,255,255,0.85)',
    borderRadius: wechat.bubbleRadius,
    paddingHorizontal: wechat.bubblePadH,
    paddingVertical: wechat.bubblePadV,
  },
  systemText: {
    fontSize: typography.caption,
    color: '#666666',
    textAlign: 'center',
    lineHeight: 18,
  },
});
