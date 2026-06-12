import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { UserPersonaSettings } from '@xzz/shared';
import { WeChatChatHeader } from '../components/WeChatChatHeader';
import { WeChatGroupedSection } from '../components/wechat/WeChatGroupedSection';
import { WeChatListCell } from '../components/wechat/WeChatListCell';
import { loadPersona } from '../lib/personaStore';
import { identityPreview, soulPreview, userPreview } from '../lib/personaUi';
import type { GroupStackParamList } from '../navigation/types';
import { wechatChatStyles } from '../theme/wechatChat';
import { zh } from '../locales/zh-CN';

type Props = NativeStackScreenProps<GroupStackParamList, 'SettingsPersonality'>;

export function SettingsPersonalityScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const [settings, setSettings] = useState<UserPersonaSettings>({});

  const load = useCallback(async () => {
    try {
      setSettings(await loadPersona());
    } catch {
      setSettings({});
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const notSet = zh.me.personalityNotSet;

  return (
    <View style={wechatChatStyles.page}>
      <WeChatChatHeader title={zh.me.personalityTitle} showBack />
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: Math.max(insets.bottom, 16) + 12 },
        ]}
      >
        <WeChatGroupedSection>
          <WeChatListCell
            label={zh.me.personalityIdentity}
            value={identityPreview(settings, notSet)}
            onPress={() => navigation.navigate('SettingsPersonalityIdentity')}
            showSeparator
          />
          <WeChatListCell
            label={zh.me.personalitySoul}
            value={soulPreview(settings, notSet)}
            onPress={() => navigation.navigate('SettingsPersonalitySoul')}
            showSeparator
          />
          <WeChatListCell
            label={zh.me.personalityUser}
            value={userPreview(settings, notSet)}
            onPress={() => navigation.navigate('SettingsPersonalityUser')}
            showSeparator={false}
          />
        </WeChatGroupedSection>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingTop: 12 },
});
