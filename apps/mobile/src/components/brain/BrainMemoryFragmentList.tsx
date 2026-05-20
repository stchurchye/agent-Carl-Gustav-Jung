import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import type { MemoryFragment } from '@xzz/shared';
import { api } from '../../lib/api';
import { apiErrorText } from '../../lib/apiError';
import { labelMemoryCategory, labelMemoryScope } from '../../brain/brainLabels';
import { zh } from '../../locales/zh-CN';
import { evaBrain } from '../../theme/evaBrain';

function categoryBadge(item: MemoryFragment): string | undefined {
  if (item.scope !== 'user') return undefined;
  return labelMemoryCategory(item.category);
}

type Props = {
  items: MemoryFragment[];
  scopeBadge?: (item: MemoryFragment) => string | undefined;
  reviewMode?: boolean;
  emptyLabel?: string;
  onChanged: () => void;
  onOpenDetail?: (id: string) => void;
};

export function BrainMemoryFragmentList({
  items,
  scopeBadge,
  reviewMode,
  emptyLabel,
  onChanged,
  onOpenDetail,
}: Props) {
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

  const reviewScopeBadge = (item: MemoryFragment) => labelMemoryScope(item.scope);

  if (items.length === 0) {
    return (
      <Text style={styles.empty}>
        {emptyLabel ?? (reviewMode ? zh.me.memoryReviewEmpty : zh.me.memoryEmpty)}
      </Text>
    );
  }

  return (
    <View style={styles.list}>
      {items.map((item) => {
        const badge =
          scopeBadge?.(item) ??
          (reviewMode ? reviewScopeBadge(item) : categoryBadge(item));
        return (
          <View key={item.id} style={styles.card}>
            {badge ? <Text style={styles.badge}>{badge}</Text> : null}
            <Pressable
              onPress={() => onOpenDetail?.(item.id)}
              disabled={!onOpenDetail}
            >
              <Text style={styles.title}>{item.title}</Text>
              <Text style={styles.body} numberOfLines={4}>
                {item.content ?? ''}
              </Text>
            </Pressable>
            <View style={styles.actions}>
              {reviewMode ? (
                <>
                  <Pressable
                    onPress={() => {
                      void api
                        .dismissMemoryReview(item.id)
                        .then(onChanged)
                        .catch((e) => Alert.alert('失败', apiErrorText(e).message));
                    }}
                  >
                    <Text style={styles.action}>{zh.me.memoryReviewKeep}</Text>
                  </Pressable>
                  <Pressable onPress={() => onSuppress(item.id)}>
                    <Text style={styles.action}>{zh.me.memoryReviewArchive}</Text>
                  </Pressable>
                  <Pressable onPress={() => onDelete(item.id)}>
                    <Text style={[styles.action, styles.actionDanger]}>
                      {zh.me.memoryDelete}
                    </Text>
                  </Pressable>
                </>
              ) : (
                <>
                  <Pressable onPress={() => onSuppress(item.id)}>
                    <Text style={styles.action}>{zh.me.memorySuppress}</Text>
                  </Pressable>
                  <Pressable onPress={() => onDelete(item.id)}>
                    <Text style={[styles.action, styles.actionDanger]}>
                      {zh.me.memoryDelete}
                    </Text>
                  </Pressable>
                </>
              )}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: 12, gap: 10 },
  empty: {
    textAlign: 'center',
    color: evaBrain.textMuted,
    marginTop: 16,
    marginBottom: 8,
    fontSize: 14,
  },
  card: {
    backgroundColor: evaBrain.bgCard,
    borderRadius: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: evaBrain.border,
    padding: 12,
  },
  badge: {
    fontSize: 11,
    color: evaBrain.accent,
    marginBottom: 6,
    fontWeight: '600',
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
    color: evaBrain.text,
    marginBottom: 4,
  },
  body: {
    fontSize: 13,
    color: evaBrain.textMuted,
    lineHeight: 18,
  },
  actions: {
    flexDirection: 'row',
    gap: 16,
    marginTop: 10,
  },
  action: {
    fontSize: 13,
    color: evaBrain.accentBright,
  },
  actionDanger: { color: evaBrain.error },
});
