import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { GroupStackParamList } from '../navigation/types';
import { AppTextInput } from '../components/AppTextInput';
import { WeChatGroupedSection } from '../components/wechat/WeChatGroupedSection';
import { api } from '../lib/api';
import { apiErrorText } from '../lib/apiError';
import { appAlert } from '../lib/appAlert';
import { colors, typography } from '../theme/colors';
import { wechat } from '../theme/wechat';
import { zh } from '../locales/zh-CN';

type Props = NativeStackScreenProps<GroupStackParamList, 'StudioManage'>;

export function StudioManageScreen({ navigation }: Props) {
  const [name, setName] = useState('');
  const [invite, setInvite] = useState('');
  const [busy, setBusy] = useState(false);

  async function createGroup() {
    const n = name.trim();
    if (!n || busy) return;
    setBusy(true);
    try {
      const res = await api.createGroup(n);
      setName('');
      navigation.replace('GroupTopics', {
        groupId: res.data.id,
        groupName: res.data.name,
      });
    } catch (e) {
      appAlert(zh.studio.createFailed, apiErrorText(e).message);
    } finally {
      setBusy(false);
    }
  }

  async function joinGroup() {
    const code = invite.trim().toUpperCase();
    if (!code || busy) return;
    setBusy(true);
    try {
      const res = await api.joinGroup(code);
      setInvite('');
      navigation.replace('GroupTopics', {
        groupId: res.data.id,
        groupName: res.data.name,
      });
    } catch (e) {
      appAlert(zh.studio.joinFailed, apiErrorText(e).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        <WeChatGroupedSection title={zh.studio.createTitle}>
          <View style={styles.field}>
            <AppTextInput
              placeholder={zh.studio.namePlaceholder}
              value={name}
              onChangeText={setName}
              editable={!busy}
            />
          </View>
          <Pressable
            style={[styles.btn, (!name.trim() || busy) && styles.btnDisabled]}
            onPress={() => void createGroup()}
            disabled={!name.trim() || busy}
          >
            <Text style={styles.btnText}>{zh.studio.createAction}</Text>
          </Pressable>
        </WeChatGroupedSection>

        <WeChatGroupedSection title={zh.studio.joinTitle}>
          <View style={styles.field}>
            <AppTextInput
              placeholder={zh.studio.invitePlaceholder}
              autoCapitalize="characters"
              value={invite}
              onChangeText={setInvite}
              editable={!busy}
            />
          </View>
          <Pressable
            style={[styles.btnOutline, (!invite.trim() || busy) && styles.btnDisabled]}
            onPress={() => void joinGroup()}
            disabled={!invite.trim() || busy}
          >
            <Text style={styles.btnOutlineText}>{zh.studio.joinAction}</Text>
          </Pressable>
        </WeChatGroupedSection>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: wechat.pageBg },
  scroll: { paddingTop: 12, paddingBottom: 32 },
  field: {
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  btn: {
    marginHorizontal: 16,
    marginBottom: 12,
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
  btnOutline: {
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.primary,
    minHeight: 44,
    justifyContent: 'center',
  },
  btnDisabled: { opacity: 0.45 },
  btnText: { color: colors.onPrimary, fontWeight: '600', fontSize: typography.body },
  btnOutlineText: { color: colors.primary, fontWeight: '600', fontSize: typography.body },
});
