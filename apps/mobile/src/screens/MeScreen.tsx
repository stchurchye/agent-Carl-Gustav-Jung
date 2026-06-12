import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { WeChatChatHeader } from '../components/WeChatChatHeader';
import { PixelListCell } from '../components/pixel/PixelListCell';
import { wechatChatStyles } from '../theme/wechatChat';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TabletFrame } from '../components/TabletFrame';
import { useLayout } from '../theme/layout';
import { zh } from '../locales/zh-CN';
import { useAuth } from '../components/AuthGate';
import type { GroupStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<GroupStackParamList, 'Settings'>;

/** 设置页:一行一卡的像素风列表(Bow Wow Know 改版) */
export function MeScreen({ navigation }: Props) {
  const { user, logout } = useAuth();
  const insets = useSafeAreaInsets();
  const { isTablet, width } = useLayout();
  const mePadX = isTablet ? 20 : 12;

  return (
    <View style={wechatChatStyles.page}>
      <WeChatChatHeader title={zh.me.settings} showBack />
      <ScrollView
        style={styles.container}
        contentContainerStyle={[
          styles.content,
          isTablet && styles.contentTablet,
          {
            paddingTop: 12,
            paddingBottom: Math.max(insets.bottom, 16),
            paddingHorizontal: mePadX,
            maxWidth: width,
            width: '100%',
            alignSelf: 'center',
          },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <TabletFrame variant="settings" scrollChild>
          <PixelListCell
            label={zh.me.myAvatar}
            onPress={() => navigation.navigate('SettingsProfileAvatar')}
          />
          <PixelListCell
            label={zh.me.myName}
            value={user?.displayName}
            onPress={() => navigation.navigate('SettingsProfileName')}
          />
          <PixelListCell
            label={zh.me.myDog}
            value={user?.pixelAvatar ? zh.me.myDogAdopted : zh.me.myDogNotAdopted}
            onPress={() => navigation.navigate('SettingsMyDog')}
          />
          {/* 狗狗的名字 / 它怎么称呼你 已收归「my bow wow → 狗狗性格」,设置页不再重复 */}
          <PixelListCell
            label={zh.me.dogSoundTitle}
            onPress={() => navigation.navigate('SettingsDogSound')}
          />
          <PixelListCell
            label={zh.me.exportTitle}
            onPress={() => navigation.navigate('SettingsTopicExport')}
          />
          <PixelListCell
            label={zh.me.clientLogTitle}
            onPress={() => navigation.navigate('SettingsClientLogs')}
          />
          <PixelListCell
            label={`退出登录${user ? `（${user.displayName}）` : ''}`}
            destructive
            onPress={() => void logout()}
          />
        </TabletFrame>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { flexGrow: 1, paddingBottom: 40 },
  contentTablet: { paddingBottom: 48 },
});
