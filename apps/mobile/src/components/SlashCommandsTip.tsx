import { StyleSheet, Text, View } from 'react-native';
import { colors, typography } from '../theme/colors';
import { zh } from '../locales/zh-CN';

type Props = {
  visible?: boolean;
};

/** 输入框上方轻提示：推广斜杠命令，减少口语误触 */
export function SlashCommandsTip({ visible = true }: Props) {
  if (!visible) return null;
  return (
    <View style={styles.wrap} accessibilityRole="text">
      <Text style={styles.text} numberOfLines={2}>
        {zh.intent.slashTip}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: 14,
    paddingTop: 4,
    paddingBottom: 2,
    backgroundColor: colors.surface,
  },
  text: {
    fontSize: typography.caption,
    color: colors.textMuted,
    lineHeight: 18,
  },
});
