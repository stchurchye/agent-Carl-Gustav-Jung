import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { GroupStackParamList } from './types';
import { GroupListScreen } from '../screens/GroupListScreen';
import { StudioManageScreen } from '../screens/StudioManageScreen';
import { StudioSearchScreen } from '../screens/StudioSearchScreen';
import { GroupTopicsScreen } from '../screens/GroupTopicsScreen';
import { GroupChatScreen } from '../screens/GroupChatScreen';
import { ChatScreen } from '../screens/ChatScreen';
import { DiaryScreen } from '../screens/DiaryScreen';
import { MeScreen } from '../screens/MeScreen';
import { SettingsDogSoundScreen } from '../screens/SettingsDogSoundScreen';
import { SettingsVoiceScreen } from '../screens/SettingsVoiceScreen';
import { SettingsTopicExportScreen } from '../screens/SettingsTopicExportScreen';
import { SettingsProfileScreen } from '../screens/SettingsProfileScreen';
import { SettingsProfileAvatarScreen } from '../screens/SettingsProfileAvatarScreen';
import { SettingsProfileNameScreen } from '../screens/SettingsProfileNameScreen';
import { SettingsPixelAvatarScreen } from '../screens/SettingsPixelAvatarScreen';
import { SettingsPersonalityScreen } from '../screens/SettingsPersonalityScreen';
import { SettingsPersonalityIdentityScreen } from '../screens/SettingsPersonalityIdentityScreen';
import { SettingsPersonalitySoulScreen } from '../screens/SettingsPersonalitySoulScreen';
import { SettingsPersonalityUserScreen } from '../screens/SettingsPersonalityUserScreen';
import { SettingsMemoryScreen } from '../screens/SettingsMemoryScreen';
import { SettingsShortMemoryScreen } from '../screens/SettingsShortMemoryScreen';
import { SettingsMemoryPrefsScreen } from '../screens/SettingsMemoryPrefsScreen';
import { SettingsMemorySearchScreen } from '../screens/SettingsMemorySearchScreen';
import { SettingsLlmLogListScreen } from '../screens/SettingsLlmLogListScreen';
import { SettingsLlmLogDetailScreen } from '../screens/SettingsLlmLogDetailScreen';
import { SettingsClientLogScreen } from '../screens/SettingsClientLogScreen';
import { SettingsDocumentsScreen } from '../screens/SettingsDocumentsScreen';
import { WritingChaptersScreen } from '../screens/WritingChaptersScreen';
import { WritingScreen } from '../screens/WritingScreen';
import { DiffPreviewScreen } from '../screens/DiffPreviewScreen';
import { RevisionHistoryScreen } from '../screens/RevisionHistoryScreen';
import { GameHubScreen } from '../features/games/GameHubScreen';
import { GameSleuthScreen } from '../features/games/sleuth/GameSleuthScreen';
import { GameEscapeScreen } from '../features/games/escape/GameEscapeScreen';
import { GamePersuadeScreen } from '../features/games/persuade/GamePersuadeScreen';
import { zh } from '../locales/zh-CN';
import { wechat } from '../theme/wechat';

const Stack = createNativeStackNavigator<GroupStackParamList>();

export function GroupStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: wechat.navBg },
        headerTintColor: wechat.textPrimary,
        headerTitleStyle: { fontWeight: '600', fontSize: wechat.navTitleSize },
        headerShadowVisible: false,
      }}
    >
      <Stack.Screen
        name="GroupList"
        component={GroupListScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="Settings"
        component={MeScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="SettingsProfile"
        component={SettingsProfileScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="SettingsProfileAvatar"
        component={SettingsProfileAvatarScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="SettingsProfileName"
        component={SettingsProfileNameScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="SettingsMyDog"
        component={SettingsPixelAvatarScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="SettingsPersonality"
        component={SettingsPersonalityScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="SettingsPersonalityIdentity"
        component={SettingsPersonalityIdentityScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="SettingsPersonalitySoul"
        component={SettingsPersonalitySoulScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="SettingsPersonalityUser"
        component={SettingsPersonalityUserScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="SettingsMemory"
        component={SettingsMemoryScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="SettingsShortMemory"
        component={SettingsShortMemoryScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="SettingsMemoryPrefs"
        component={SettingsMemoryPrefsScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="SettingsMemorySearch"
        component={SettingsMemorySearchScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="SettingsLlmLogs"
        component={SettingsLlmLogListScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="SettingsLlmLogDetail"
        component={SettingsLlmLogDetailScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="SettingsClientLogs"
        component={SettingsClientLogScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="SettingsDogSound"
        component={SettingsDogSoundScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="SettingsVoice"
        component={SettingsVoiceScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="SettingsTopicExport"
        component={SettingsTopicExportScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="SettingsDocuments"
        component={SettingsDocumentsScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="StudioManage"
        component={StudioManageScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="StudioSearch"
        component={StudioSearchScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="GameHub"
        component={GameHubScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="GameSleuth"
        component={GameSleuthScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="GameEscape"
        component={GameEscapeScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="GamePersuade"
        component={GamePersuadeScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="PrivateChat"
        component={ChatScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen name="Diary" component={DiaryScreen} options={{ headerShown: false }} />
      <Stack.Screen
        name="GroupTopics"
        component={GroupTopicsScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="GroupChat"
        component={GroupChatScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="WritingChapters"
        component={WritingChaptersScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="WritingMain"
        component={WritingScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="DiffPreview"
        component={DiffPreviewScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="RevisionHistory"
        component={RevisionHistoryScreen}
        options={{ title: zh.writing.history }}
      />
    </Stack.Navigator>
  );
}
