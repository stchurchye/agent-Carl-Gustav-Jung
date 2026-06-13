import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WeChatChatHeader } from '../../components/WeChatChatHeader';
import { PixelListCell } from '../../components/pixel/PixelListCell';
import { wechatChatStyles } from '../../theme/wechatChat';
import { zh } from '../../locales/zh-CN';
import type { GroupStackParamList } from '../../navigation/types';

type GameRoute = 'GameSleuth' | 'GamePersuade' | 'GameDrama';

/** 合集菜单的单一来源:加新游戏只动这张表 */
const GAMES: { route: GameRoute; name: string; tagline: string }[] = [
  { route: 'GameDrama', name: zh.games.drama.name, tagline: zh.games.drama.tagline },
  { route: 'GameSleuth', name: zh.games.sleuth.name, tagline: zh.games.sleuth.tagline },
  { route: 'GamePersuade', name: zh.games.persuade.name, tagline: zh.games.persuade.tagline },
];

type Props = NativeStackScreenProps<GroupStackParamList, 'GameHub'>;

/** 小游戏合集首页:一行一卡的像素菜单,从「我的」进入 */
export function GameHubScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();

  return (
    <View style={wechatChatStyles.page}>
      <WeChatChatHeader title={zh.games.hubTitle} showBack />
      <ScrollView
        style={styles.container}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: Math.max(insets.bottom, 16) },
        ]}
      >
        <Text style={styles.hint}>{zh.games.hubHint}</Text>
        {GAMES.map((g) => (
          <PixelListCell
            key={g.route}
            label={g.name}
            value={g.tagline}
            onPress={() => navigation.navigate(g.route)}
          />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingTop: 12, paddingHorizontal: 12 },
  hint: { fontSize: 13, color: '#8A8377', marginBottom: 12, paddingHorizontal: 2 },
});
