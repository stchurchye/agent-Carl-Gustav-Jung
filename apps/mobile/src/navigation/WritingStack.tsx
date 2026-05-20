import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { DiffPreviewScreen } from '../screens/DiffPreviewScreen';
import { RevisionHistoryScreen } from '../screens/RevisionHistoryScreen';
import { WritingChaptersScreen } from '../screens/WritingChaptersScreen';
import { WritingScreen } from '../screens/WritingScreen';
import type { WritingStackParamList } from './types';
import { colors } from '../theme/colors';

const Stack = createNativeStackNavigator<WritingStackParamList>();

export function WritingStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
        headerTitleStyle: { fontWeight: '600' },
        contentStyle: { backgroundColor: colors.background },
      }}
    >
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
        options={{ title: '历史版本' }}
      />
    </Stack.Navigator>
  );
}
