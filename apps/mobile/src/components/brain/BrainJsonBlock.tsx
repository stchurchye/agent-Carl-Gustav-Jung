import * as Clipboard from 'expo-clipboard';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { appAlert } from '../../lib/appAlert';
import { zh } from '../../locales/zh-CN';
import { brainTokens } from '../../theme/brainTokens';

type Props = {
  data: unknown;
  title?: string;
};

export function BrainJsonBlock({ data, title = zh.brain.rawJson }: Props) {
  const text = JSON.stringify(data, null, 2);

  const onCopy = async () => {
    await Clipboard.setStringAsync(text);
    appAlert(zh.brain.actions.copied);
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <Text style={styles.title}>{title}</Text>
        <Pressable onPress={() => void onCopy()} accessibilityRole="button">
          <Text style={styles.copy}>{zh.brain.actions.copyJson}</Text>
        </Pressable>
      </View>
      <Text style={styles.body} selectable>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginHorizontal: 12,
    marginBottom: 12,
    padding: 10,
    backgroundColor: brainTokens.bgElevated,
    borderRadius: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: brainTokens.borderSubtle,
  },
  head: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  title: {
    color: brainTokens.accent,
    fontSize: 12,
    fontWeight: '600',
  },
  copy: {
    color: brainTokens.info,
    fontSize: 12,
  },
  body: {
    color: brainTokens.textMuted,
    fontSize: 11,
    fontFamily: brainTokens.mono,
    lineHeight: 16,
  },
});
