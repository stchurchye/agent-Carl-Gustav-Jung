import * as Clipboard from 'expo-clipboard';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { appAlert } from '../../lib/appAlert';
import { zh } from '../../locales/zh-CN';
import { evaBrain } from '../../theme/evaBrain';

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
    backgroundColor: evaBrain.bgElevated,
    borderRadius: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: evaBrain.borderSubtle,
  },
  head: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  title: {
    color: evaBrain.accent,
    fontSize: 12,
    fontWeight: '600',
  },
  copy: {
    color: evaBrain.info,
    fontSize: 12,
  },
  body: {
    color: evaBrain.textMuted,
    fontSize: 11,
    fontFamily: evaBrain.mono,
    lineHeight: 16,
  },
});
