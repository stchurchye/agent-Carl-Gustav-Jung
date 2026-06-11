import {
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ListRenderItemInfo,
} from 'react-native';
import type { ChapterCatalogItem } from '../lib/writingChapterCatalog';
import { colors, typography } from '../theme/colors';
import { wechat } from '../theme/wechat';
import { zh } from '../locales/zh-CN';

const LEFT_WIDTH = 92;
const PREVIEW_MAX = 48;

type Props = {
  types: string[];
  activeType: string;
  items: ChapterCatalogItem[];
  onSelectType: (type: string) => void;
  onAddType: () => void;
  onPressChapter: (item: ChapterCatalogItem) => void;
  onLongPressChapter: (item: ChapterCatalogItem) => void;
};

function previewSnippet(text: string): string {
  const t = text.trim().replace(/\s+/g, ' ');
  if (!t || t === zh.writing.empty) return zh.writing.empty;
  return t.length <= PREVIEW_MAX ? t : `${t.slice(0, PREVIEW_MAX)}…`;
}

export function WritingChapterCatalog({
  types,
  activeType,
  items,
  onSelectType,
  onAddType,
  onPressChapter,
  onLongPressChapter,
}: Props) {
  const renderChapter = ({ item }: ListRenderItemInfo<ChapterCatalogItem>) => (
    <Pressable
      style={styles.chapterRow}
      onPress={() => onPressChapter(item)}
      onLongPress={() => onLongPressChapter(item)}
      accessibilityRole="button"
      accessibilityLabel={`${item.index}${item.note ? `，${item.note}` : ''}`}
    >
      <View style={styles.chapterIndexWrap}>
        <Text style={styles.chapterIndex}>{item.index}</Text>
      </View>
      <View style={styles.chapterBody}>
        {item.note ? (
          <Text style={styles.chapterNote} numberOfLines={1}>
            {item.note}
          </Text>
        ) : null}
        <Text style={styles.chapterPreview} numberOfLines={2}>
          {previewSnippet(item.preview)}
        </Text>
      </View>
    </Pressable>
  );

  return (
    <View style={styles.root}>
      <View style={styles.leftRail}>
        <ScrollView showsVerticalScrollIndicator={false}>
          {types.map((type) => {
            const selected = type === activeType;
            return (
              <Pressable
                key={type}
                style={[styles.typeItem, selected && styles.typeItemActive]}
                onPress={() => onSelectType(type)}
                accessibilityRole="button"
                accessibilityState={{ selected }}
              >
                {selected ? <View style={styles.typeIndicator} /> : null}
                <Text
                  style={[styles.typeLabel, selected && styles.typeLabelActive]}
                  numberOfLines={1}
                >
                  {type}
                </Text>
              </Pressable>
            );
          })}
          <Pressable
            style={styles.addTypeBtn}
            onPress={onAddType}
            accessibilityRole="button"
            accessibilityLabel={zh.writing.addChapterType}
          >
            <Text style={styles.addTypeText}>+ {zh.writing.addChapterType}</Text>
          </Pressable>
        </ScrollView>
      </View>

      <View style={styles.rightPane}>
        {items.length > 0 ? (
          <FlatList
            data={items}
            keyExtractor={(item) => item.chapterId}
            renderItem={renderChapter}
            contentContainerStyle={styles.chapterList}
            showsVerticalScrollIndicator={false}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
          />
        ) : (
          <View style={styles.rightEmpty}>
            <Text style={styles.rightEmptyText}>{zh.writing.chaptersEmptyInType}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: wechat.cellBg,
  },
  leftRail: {
    width: LEFT_WIDTH,
    backgroundColor: wechat.navBg,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: colors.border,
  },
  typeItem: {
    minHeight: 52,
    paddingVertical: 14,
    paddingHorizontal: 10,
    justifyContent: 'center',
    position: 'relative',
  },
  typeItemActive: {
    backgroundColor: colors.surface,
  },
  typeIndicator: {
    position: 'absolute',
    left: 0,
    top: 10,
    bottom: 10,
    width: 3,
    borderRadius: 2,
    backgroundColor: colors.primary,
  },
  typeLabel: {
    fontSize: typography.body,
    color: colors.textMuted,
    textAlign: 'center',
  },
  typeLabelActive: {
    color: colors.text,
    fontWeight: '600',
  },
  addTypeBtn: {
    paddingVertical: 14,
    paddingHorizontal: 6,
    alignItems: 'center',
  },
  addTypeText: {
    fontSize: typography.small,
    color: colors.link,
    textAlign: 'center',
  },
  rightPane: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  chapterList: {
    paddingBottom: 16,
  },
  chapterRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: colors.surface,
  },
  chapterIndexWrap: {
    width: 40,
    marginRight: 12,
    alignItems: 'center',
    paddingTop: 2,
  },
  chapterIndex: {
    fontSize: typography.body + 2,
    fontWeight: '700',
    color: colors.text,
  },
  chapterBody: {
    flex: 1,
    minWidth: 0,
  },
  chapterNote: {
    fontSize: typography.body,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 4,
  },
  chapterPreview: {
    fontSize: typography.caption,
    color: colors.textMuted,
    lineHeight: 20,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginLeft: 16 + 40 + 12,
  },
  rightEmpty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  rightEmptyText: {
    fontSize: typography.body,
    color: colors.textMuted,
    textAlign: 'center',
  },
});
