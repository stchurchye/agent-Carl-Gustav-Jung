import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WeChatChatHeader } from '../components/WeChatChatHeader';
import { ChatAvatar } from '../components/ChatAvatar';
import { WeChatGroupedSection } from '../components/wechat/WeChatGroupedSection';
import { WeChatListCell } from '../components/wechat/WeChatListCell';
import { useAuth } from '../components/AuthGate';
import type { GroupStackParamList } from '../navigation/types';
import { wechatListStyles } from '../theme/wechatList';
import { wechatChatStyles } from '../theme/wechatChat';
import { zh } from '../locales/zh-CN';

type Props = NativeStackScreenProps<GroupStackParamList, 'SettingsProfile'>;

/** 个人资料入口：头像、名字分列，各自进入二级页编辑 */
export function SettingsProfileScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  return (
    <View style={wechatChatStyles.page}>
      <WeChatChatHeader title={zh.me.profileTitle} showBack />
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: Math.max(insets.bottom, 16) + 12 },
        ]}
      >
        <WeChatGroupedSection>
          <WeChatListCell
            label={zh.me.profileAvatar}
            right={
              user ? (
                <View style={styles.avatarRow}>
                  <ChatAvatar
                    name={user.displayName}
                    seed={user.id}
                    size={40}
                    imageUri={user.avatarDisplayUrl}
                  />
                  <Text style={wechatListStyles.cellChevron}>›</Text>
                </View>
              ) : null
            }
            showChevron={false}
            onPress={() => navigation.navigate('SettingsProfileAvatar')}
            showSeparator
          />
          <WeChatListCell
            label={zh.me.profileName}
            value={user?.displayName}
            onPress={() => navigation.navigate('SettingsProfileName')}
            showSeparator={false}
          />
        </WeChatGroupedSection>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingTop: 12 },
  avatarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
});
