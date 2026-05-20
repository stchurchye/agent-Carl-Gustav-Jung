import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import type { MemoryFragment } from '@xzz/shared';
import { WeChatGroupedSection } from './wechat/WeChatGroupedSection';
import { api } from '../lib/api';
import { apiErrorText } from '../lib/apiError';
import { colors, typography } from '../theme/colors';
import { zh } from '../locales/zh-CN';

function categoryLabel(item: MemoryFragment): string | undefined {
  if (item.scope !== 'user') return undefined;
  if (item.category === 'user_profile') return zh.me.memoryCategoryProfile;
  if (item.category === 'project_note') return zh.me.memoryCategoryProject;
  if (item.category === 'general') return zh.me.memoryCategoryGeneral;
  return undefined;
}

type Props = {
  items: MemoryFragment[];
  scopeBadge?: (item: MemoryFragment) => string | undefined;
  onChanged: () => void;
};

export function MemoryFragmentList({ items, scopeBadge, onChanged }: Props) {
  const onDelete = (id: string) => {
    Alert.alert(zh.me.memoryDelete, '', [
      { text: '取消', style: 'cancel' },
      {
        text: zh.me.memoryDelete,
        style: 'destructive',
        onPress: () => {
          void api.deleteMemory(id).then(onChanged).catch((e) => {
            Alert.alert('失败', apiErrorText(e).message);
          });
        },
      },
    ]);
  };

  const onSuppress = (id: string) => {
    void api
      .patchMemory(id, { status: 'suppressed' })
      .then(onChanged)
      .catch((e) => Alert.alert('失败', apiErrorText(e).message));
  };

  if (items.length === 0) {
    return <Text style={styles.empty}>{zh.me.memoryEmpty}</Text>;
  }

  return (
    <WeChatGroupedSection>
      {items.map((item, idx) => {
        const badge = scopeBadge?.(item) ?? categoryLabel(item);
        return (
          <View
            key={item.id}
            style={[styles.row, idx < items.length - 1 && styles.rowBorder]}
          >
            {badge ? <Text style={styles.badge}>{badge}</Text> : null}
            <Text style={styles.rowTitle}>{item.title}</Text>
            <Text style={styles.rowBody} numberOfLines={4}>
              {item.content ?? ''}
            </Text>
            <View style={styles.actions}>
              <Pressable onPress={() => onSuppress(item.id)} hitSlop={8}>
                <Text style={styles.action}>{zh.me.memorySuppress}</Text>
              </Pressable>
              <Pressable onPress={() => onDelete(item.id)} hitSlop={8}>
                <Text style={[styles.action, styles.actionDanger]}>
                  {zh.me.memoryDelete}
                </Text>
              </Pressable>
            </View>
          </View>
        );
      })}
    </WeChatGroupedSection>
  );
}

const styles = StyleSheet.create({
  empty: {
    textAlign: 'center',
    color: colors.textMuted,
    marginTop: 16,
    marginBottom: 8,
    fontSize: typography.body,
  },
  row: { paddingHorizontal: 16, paddingVertical: 12 },
  rowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  badge: {
    fontSize: typography.caption,
    color: colors.primary,
    marginBottom: 4,
    fontWeight: '600',
  },
  rowTitle: {
    fontSize: typography.body,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 4,
  },
  rowBody: {
    fontSize: typography.caption,
    color: colors.textMuted,
    lineHeight: 20,
  },
  actions: {
    flexDirection: 'row',
    gap: 16,
    marginTop: 10,
  },
  action: {
    fontSize: typography.caption,
    color: colors.primary,
  },
  actionDanger: { color: '#c44' },
});
