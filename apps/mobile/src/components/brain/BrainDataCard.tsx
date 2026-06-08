import { StyleSheet, Text, View } from 'react-native';
import { brainTokens } from '../../theme/brainTokens';

type Field = { label: string; value: string };

type Props = {
  title?: string;
  fields: Field[];
  footer?: string;
};

export function BrainDataCard({ title, fields, footer }: Props) {
  return (
    <View style={styles.card}>
      {title ? <Text style={styles.cardTitle}>〔 {title} 〕</Text> : null}
      {fields.map((f) => (
        <View key={f.label} style={styles.row}>
          <Text style={styles.label}>{f.label}</Text>
          <Text style={styles.value} selectable>
            {f.value || '—'}
          </Text>
        </View>
      ))}
      {footer ? <Text style={styles.footer}>{footer}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 12,
    marginBottom: 10,
    padding: 12,
    backgroundColor: brainTokens.bgCard,
    borderRadius: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: brainTokens.border,
  },
  cardTitle: {
    color: brainTokens.accentBright,
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 10,
  },
  row: {
    marginBottom: 8,
  },
  label: {
    color: brainTokens.accent,
    fontSize: 11,
    marginBottom: 2,
  },
  value: {
    color: brainTokens.text,
    fontSize: 13,
    lineHeight: 18,
  },
  footer: {
    marginTop: 4,
    color: brainTokens.textDim,
    fontSize: 11,
  },
});
