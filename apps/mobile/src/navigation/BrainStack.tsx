import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { BrainStackParamList } from './types';
import { BrainHubScreen } from '../screens/brain/BrainHubScreen';
import { BrainPersonalityEditScreen } from '../screens/brain/BrainPersonalityEditScreen';
import { SettingsPersonalityIdentityScreen } from '../screens/SettingsPersonalityIdentityScreen';
import { SettingsPersonalitySoulScreen } from '../screens/SettingsPersonalitySoulScreen';
import { SettingsPersonalityUserScreen } from '../screens/SettingsPersonalityUserScreen';
import { BrainMemoryHubScreen } from '../screens/brain/BrainMemoryHubScreen';
import { BrainLongMemoryScreen } from '../screens/brain/BrainLongMemoryScreen';
import { BrainShortMemoryScreen } from '../screens/brain/BrainShortMemoryScreen';
import { BrainSessionSearchScreen } from '../screens/brain/BrainSessionSearchScreen';
import { BrainMemoryReviewScreen } from '../screens/brain/BrainMemoryReviewScreen';
import { BrainHermesScreen } from '../screens/brain/BrainHermesScreen';
import { BrainMemoryPrefsScreen } from '../screens/brain/BrainMemoryPrefsScreen';
import { BrainLlmLogsScreen } from '../screens/brain/BrainLlmLogsScreen';
import { BrainLlmLogDetailScreen } from '../screens/brain/BrainLlmLogDetailScreen';
import { BrainMemoryDetailScreen } from '../screens/brain/BrainMemoryDetailScreen';
import { BrainHomeKeysScreen } from '../screens/brain/BrainHomeKeysScreen';
import { ApiKeyDetailScreen } from '../screens/ApiKeyDetailScreen';
import { SettingsMemoryScreen } from '../screens/SettingsMemoryScreen';
import { BrainAgentTasksScreen } from '../screens/brain/BrainAgentTasksScreen';
import { BrainAgentTaskDetailScreen } from '../screens/brain/BrainAgentTaskDetailScreen';
import { BrainAgentDefaultModelScreen } from '../screens/brain/BrainAgentDefaultModelScreen';
import { evaBrain } from '../theme/evaBrain';

const Stack = createNativeStackNavigator<BrainStackParamList>();

export function BrainStack() {
  return (
    <Stack.Navigator
      initialRouteName="BrainHub"
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: evaBrain.bg },
      }}
    >
      <Stack.Screen name="BrainHub" component={BrainHubScreen} />
      <Stack.Screen name="BrainPersonalityEdit" component={BrainPersonalityEditScreen} />
      <Stack.Screen
        name="SettingsPersonalityIdentity"
        component={SettingsPersonalityIdentityScreen}
      />
      <Stack.Screen name="SettingsPersonalitySoul" component={SettingsPersonalitySoulScreen} />
      <Stack.Screen name="SettingsPersonalityUser" component={SettingsPersonalityUserScreen} />
      <Stack.Screen name="BrainMemoryHub" component={BrainMemoryHubScreen} />
      <Stack.Screen name="BrainLongMemory" component={BrainLongMemoryScreen} />
      <Stack.Screen name="BrainShortMemory" component={BrainShortMemoryScreen} />
      <Stack.Screen name="BrainSessionSearch" component={BrainSessionSearchScreen} />
      <Stack.Screen name="BrainMemoryReview" component={BrainMemoryReviewScreen} />
      <Stack.Screen name="BrainHermes" component={BrainHermesScreen} />
      <Stack.Screen name="BrainMemoryPrefs" component={BrainMemoryPrefsScreen} />
      <Stack.Screen name="BrainLlmLogs" component={BrainLlmLogsScreen} />
      <Stack.Screen name="BrainLlmLogDetail" component={BrainLlmLogDetailScreen} />
      <Stack.Screen name="BrainMemoryDetail" component={BrainMemoryDetailScreen} />
      <Stack.Screen name="BrainHomeKeys" component={BrainHomeKeysScreen} />
      <Stack.Screen name="ApiKeyDetail" component={ApiKeyDetailScreen} />
      <Stack.Screen name="SettingsMemory" component={SettingsMemoryScreen} />
      <Stack.Screen name="BrainAgentTasks" component={BrainAgentTasksScreen} />
      <Stack.Screen name="BrainAgentTaskDetail" component={BrainAgentTaskDetailScreen} />
      <Stack.Screen name="BrainAgentDefaultModel" component={BrainAgentDefaultModelScreen} />
    </Stack.Navigator>
  );
}
