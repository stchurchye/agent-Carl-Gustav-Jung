import type { NavigationProp, ParamListBase } from '@react-navigation/native';
import type { AppNavigateTarget, IntentKind, MemoryIntentSlots } from '@xzz/shared';
import type { GroupStackParamList } from '../navigation/types';
import { navigateBrainTab } from './navigateBrain';

export type AppNavigateContext = {
  sessionId?: string;
  groupId?: string;
  topicId?: string;
};

export function isClientNavigateKind(kind: IntentKind): boolean {
  return kind === 'app_navigate' || kind === 'persona_open_settings';
}

export function resolveNavigateTarget(
  kind: IntentKind,
  slots?: MemoryIntentSlots,
): AppNavigateTarget | null {
  if (kind === 'persona_open_settings') return 'personality';
  if (kind === 'app_navigate') return slots?.navigateTarget ?? null;
  return null;
}

/** 客户端跳转；返回是否已处理 */
export function applyAppNavigate(
  navigation: NavigationProp<GroupStackParamList>,
  kind: IntentKind,
  slots: MemoryIntentSlots | undefined,
  ctx: AppNavigateContext,
): boolean {
  const target = resolveNavigateTarget(kind, slots);
  if (!target) return false;

  switch (target) {
    case 'personality':
      navigateBrainTab(navigation, 'BrainPersonalityEdit');
      return true;
    case 'personality_identity':
      navigateBrainTab(navigation, 'SettingsPersonalityIdentity');
      return true;
    case 'personality_soul':
      navigateBrainTab(navigation, 'SettingsPersonalitySoul');
      return true;
    case 'personality_user':
      navigateBrainTab(navigation, 'SettingsPersonalityUser');
      return true;
    case 'memory_long':
      navigateBrainTab(navigation, 'BrainLongMemory');
      return true;
    case 'memory_short':
      navigateBrainTab(navigation, 'BrainShortMemory');
      return true;
    case 'memory_session':
      if (ctx.sessionId) {
        navigateBrainTab(navigation, 'SettingsMemory', {
          scope: 'session',
          sessionId: ctx.sessionId,
        });
        return true;
      }
      navigateBrainTab(navigation, 'BrainShortMemory');
      return true;
    case 'memory_topic':
      if (ctx.groupId && ctx.topicId) {
        navigateBrainTab(navigation, 'SettingsMemory', {
          scope: 'topic',
          groupId: ctx.groupId,
          topicId: ctx.topicId,
        });
        return true;
      }
      navigateBrainTab(navigation, 'BrainShortMemory');
      return true;
    case 'llm_logs':
      navigateBrainTab(navigation, 'BrainLlmLogs');
      return true;
    case 'client_logs':
      navigation.navigate('SettingsClientLogs');
      return true;
    case 'api_keys':
      navigateBrainTab(navigation, 'BrainHomeKeys');
      return true;
    case 'voice':
      navigation.navigate('SettingsVoice');
      return true;
    case 'export':
      navigation.navigate('SettingsTopicExport');
      return true;
    case 'documents':
      navigation.navigate('SettingsDocuments', { scope: 'visible' });
      return true;
    case 'profile':
      navigation.navigate('SettingsProfile');
      return true;
    case 'studio_settings':
      navigation.navigate('Settings');
      return true;
    default:
      return false;
  }
}
