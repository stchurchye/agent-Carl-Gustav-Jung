import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme/colors';

/** 小红书等竖屏长图常用宽度（逻辑像素） */
export const SHARE_CARD_WIDTH = 750;

type Props = {
  documentTitle: string;
  chapterTitle: string;
  body: string;
};

export function ChapterShareCard({ documentTitle, chapterTitle, body }: Props) {
  const paragraphs = body
    .trim()
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean);

  return (
    <View style={styles.card} collapsable={false}>
      <Text style={styles.docTitle}>{documentTitle}</Text>
      <Text style={styles.chapterTitle}>{chapterTitle}</Text>
      <View style={styles.rule} />
      <View style={styles.body}>
        {paragraphs.map((paragraph, index) => (
          <Text key={index} style={styles.paragraph}>
            {'　　'}
            {paragraph}
          </Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: SHARE_CARD_WIDTH,
    backgroundColor: colors.background,
    paddingHorizontal: 56,
    paddingTop: 72,
    paddingBottom: 72,
  },
  docTitle: {
    fontSize: 34,
    color: colors.textMuted,
    letterSpacing: 1,
    marginBottom: 12,
  },
  chapterTitle: {
    fontSize: 52,
    fontWeight: '700',
    color: colors.text,
    lineHeight: 64,
    marginBottom: 8,
  },
  rule: {
    height: 1,
    backgroundColor: '#e0d4c8',
    marginTop: 28,
    marginBottom: 36,
  },
  body: {
    gap: 28,
  },
  paragraph: {
    fontSize: 40,
    lineHeight: 62,
    color: colors.text,
    letterSpacing: 0.5,
  },
});
