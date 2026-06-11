import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { Revision } from '@xzz/shared';
import { formatRevisionTime, groupRevisionsByDay } from '@xzz/shared';
import { appAlert } from '../lib/appAlert';
import { api } from '../lib/api';
import { openDiffPreview } from '../lib/openDiffPreview';
import { WeChatListCell } from '../components/wechat/WeChatListCell';
import { WeChatGroupedSection } from '../components/wechat/WeChatGroupedSection';
import { TabletFrame } from '../components/TabletFrame';
import { wechatListStyles } from '../theme/wechatList';
import { zh } from '../locales/zh-CN';
import type { GroupStackParamList } from '../navigation/types';
import { openWriting } from '../lib/openWriting';
import { wechatChatStyles } from '../theme/wechatChat';

type Props = NativeStackScreenProps<GroupStackParamList, 'RevisionHistory'>;

export function RevisionHistoryScreen({ route, navigation }: Props) {
  const { documentId, title } = route.params;
  const [revisions, setRevisions] = useState<Revision[]>([]);

  const load = useCallback(async () => {
    const res = await api.listRevisions(documentId);
    setRevisions(res.data.filter((r) => r.status === 'accepted' || r.status === 'pending'));
  }, [documentId]);

  useEffect(() => {
    load();
  }, [load]);

  const groups = groupRevisionsByDay(revisions);

  const rollback = (rev: Revision) => {
    const time = formatRevisionTime(rev.createdAt);
    appAlert(
      zh.diff.rollback,
      `${zh.diff.rollbackConfirm}\n\n${time.full}`,
      [
        { text: zh.common.back, style: 'cancel' },
        {
          text: zh.common.confirm,
          onPress: async () => {
            await api.rollback(documentId, rev.id);
            void openWriting(navigation, {
              documentId,
              blockId: rev.blockId ?? undefined,
              allowDisabled: true, // 写作功能内部二跳,入口已被门控
            });
          },
        },
      ],
    );
  };

  return (
    <ScrollView style={wechatChatStyles.page} contentContainerStyle={styles.content}>
      <TabletFrame variant="content" scrollChild>
        <Text style={styles.title}>
          {zh.writing.history} · {title}
        </Text>
        {groups.map((group) => (
          <WeChatGroupedSection key={group.dateKey} title={group.groupTitle}>
            {group.items.map((rev, idx) => {
              const t = formatRevisionTime(rev.createdAt);
              const isPending = rev.status === 'pending';
              return (
                <WeChatListCell
                  key={rev.id}
                  label={rev.summary}
                  value={isPending ? zh.diff.pendingBadge : t.itemTime}
                  showSeparator={idx < group.items.length - 1}
                  onPress={() => {
                    if (isPending) {
                      openDiffPreview(navigation, documentId, rev);
                      return;
                    }
                    rollback(rev);
                  }}
                />
              );
            })}
          </WeChatGroupedSection>
        ))}
        {revisions.length === 0 ? (
          <View style={wechatListStyles.footer}>
            <Text style={wechatListStyles.footerText}>
              还没有保存的版本，写完一段就会帮您记下来。
            </Text>
          </View>
        ) : null}
      </TabletFrame>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: 12, paddingBottom: 40 },
  title: {
    fontSize: 17,
    fontWeight: '600',
    color: '#191919',
    marginBottom: 12,
    paddingHorizontal: 16,
  },
});
