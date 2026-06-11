import React, { useRef } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ListRenderItem,
} from 'react-native';

type Props<T> = {
  visible: boolean;
  onClose: () => void;
  title?: string;
  /** screen 现成的 messagesUi 与 renderMessage 闭包直接注入:AgentRunCard/长按菜单零改动复用 */
  data: T[];
  renderItem: ListRenderItem<T>;
  keyExtractor: (item: T, index: number) => string;
  /** 打开即滚到底(看最新);搜索跳转场景由 screen 自己 scrollToIndex */
  listRef?: React.RefObject<FlatList<T> | null>;
};

/** 点角色/点气泡 → 经典消息列表浮层(完整历史 + 完整 agent 卡片) */
export function StageHistoryOverlay<T>({
  visible,
  onClose,
  title,
  data,
  renderItem,
  keyExtractor,
  listRef,
}: Props<T>) {
  const innerRef = useRef<FlatList<T>>(null);
  const ref = listRef ?? innerRef;
  const didInitialScroll = useRef(false);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} transparent={false}>
      <View style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.title} numberOfLines={1}>
            {title ?? '完整对话'}
          </Text>
          <Pressable onPress={onClose} style={styles.closeBtn} accessibilityRole="button" testID="overlay-close">
            <Text style={styles.closeText}>收起</Text>
          </Pressable>
        </View>
        <FlatList
          ref={ref}
          data={data}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          contentContainerStyle={styles.listContent}
          onContentSizeChange={() => {
            if (!didInitialScroll.current && data.length > 0) {
              didInitialScroll.current = true;
              ref.current?.scrollToEnd({ animated: false });
            }
          }}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#FAF9F5' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingTop: 54,
    paddingBottom: 10,
    borderBottomWidth: 2,
    borderBottomColor: '#3D3229',
    backgroundColor: '#FFFDF7',
  },
  title: { fontSize: 16, fontWeight: '700', color: '#3D3229', flex: 1 },
  closeBtn: {
    borderWidth: 2,
    borderColor: '#3D3229',
    borderRadius: 4,
    paddingHorizontal: 12,
    paddingVertical: 4,
    backgroundColor: '#F0EEE6',
  },
  closeText: { fontWeight: '700', color: '#3D3229', fontSize: 13 },
  listContent: { paddingHorizontal: 12, paddingVertical: 10 },
});
