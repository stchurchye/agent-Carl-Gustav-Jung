import { useCallback, useState } from 'react';
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
import { useFocusEffect } from '@react-navigation/native';
import type { GroupListItem } from '@xzz/shared';
import type { GroupStackParamList } from '../navigation/types';
import { AppTextInput } from '../components/AppTextInput';
import { WeChatChatHeader } from '../components/WeChatChatHeader';
import { WeChatGroupedSection } from '../components/wechat/WeChatGroupedSection';
import { WeChatListCell } from '../components/wechat/WeChatListCell';
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

  // 创建话题：可选的 Group 列表 + 当前选中
  const [groups, setGroups] = useState<GroupListItem[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [topicName, setTopicName] = useState('');

  useFocusEffect(
    useCallback(() => {
      void api.listGroups().then((res) => {
        setGroups(res.data);
        // 只有一个组时自动选中
        if (res.data.length === 1) setSelectedGroupId(res.data[0].id);
      }).catch(() => {});
    }, []),
  );

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

  async function createTopic() {
    if (!selectedGroupId || busy) return;
    const n = topicName.trim() || zh.studio.newTopicDefaultName;
    const group = groups.find((g) => g.id === selectedGroupId);
    if (!group) return;
    setBusy(true);
    try {
      const res = await api.createTopic(selectedGroupId, n);
      setTopicName('');
      navigation.replace('GroupChat', {
        groupId: selectedGroupId,
        groupName: group.name,
        topicId: res.data.id,
        topicName: res.data.title,
      });
    } catch (e) {
      appAlert(zh.studio.newTopicFailed, apiErrorText(e).message);
    } finally {
      setBusy(false);
    }
  }

  const canCreateTopic = Boolean(selectedGroupId) && !busy;

  return (
    <View style={styles.root}>
      <WeChatChatHeader title={zh.studio.manageTitle} showBack />
      <KeyboardAvoidingView
        style={styles.flex}
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

          <WeChatGroupedSection title={zh.studio.newTopicSection}>
            {groups.length === 0 ? (
              <View style={styles.emptyHintWrap}>
                <Text style={styles.emptyHint}>{zh.studio.newTopicNoGroups}</Text>
              </View>
            ) : (
              <>
                {groups.length > 1 ? (
                  <View style={styles.groupPicker}>
                    {groups.map((g) => (
                      <WeChatListCell
                        key={g.id}
                        label={g.name}
                        right={
                          selectedGroupId === g.id ? (
                            <Text style={styles.checkmark}>✓</Text>
                          ) : undefined
                        }
                        showChevron={false}
                        onPress={() => setSelectedGroupId(g.id)}
                      />
                    ))}
                  </View>
                ) : null}
                <View style={styles.field}>
                  <AppTextInput
                    placeholder={zh.studio.newTopicDefaultName}
                    value={topicName}
                    onChangeText={setTopicName}
                    editable={!busy}
                  />
                </View>
                <Pressable
                  style={[styles.btnTopic, !canCreateTopic && styles.btnDisabled]}
                  onPress={() => void createTopic()}
                  disabled={!canCreateTopic}
                >
                  <Text style={styles.btnText}>{zh.studio.newTopicAction}</Text>
                </Pressable>
              </>
            )}
          </WeChatGroupedSection>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: wechat.pageBg },
  flex: { flex: 1 },
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
  btnTopic: {
    marginHorizontal: 16,
    marginBottom: 12,
    backgroundColor: colors.accent,
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
  groupPicker: { marginBottom: 4 },
  checkmark: { fontSize: 16, color: colors.accent, fontWeight: '600', marginLeft: 8 },
  emptyHintWrap: { paddingHorizontal: 16, paddingVertical: 14 },
  emptyHint: { fontSize: typography.small, color: colors.textMuted },
});
