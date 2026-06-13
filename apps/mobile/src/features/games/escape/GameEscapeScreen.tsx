import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { StyleSheet, Text, View } from 'react-native';
import { WeChatChatHeader } from '../../../components/WeChatChatHeader';
import { wechatChatStyles } from '../../../theme/wechatChat';
import { zh } from '../../../locales/zh-CN';
import type { GroupStackParamList } from '../../../navigation/types';

type Props = NativeStackScreenProps<GroupStackParamList, 'GameEscape'>;

/** 狗狗越狱 —— 占位屏(Slice 2 实现真实玩法) */
export function GameEscapeScreen(_props: Props) {
  return (
    <View style={wechatChatStyles.page}>
      <WeChatChatHeader title={zh.games.escape.name} showBack />
      <View style={styles.center}>
        <Text style={styles.soon}>{zh.games.comingSoon}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  soon: { fontSize: 16, color: '#8A8377' },
});
