import { Pressable, StyleSheet, Text } from 'react-native';
import { zenmuxChatModelShort, zenmuxModelCompany } from '@xzz/shared';
import { buildCompanySprite } from '../pixel/grids/companyLogos';
import type { CompanyLogoKey } from '../pixel/grids/companyLogos';
import { PixelSprite } from './pixel/PixelSprite';
import { wechat } from '../theme/wechat';

type Props = {
  modelId: string;
  onPress: () => void;
  accessibilityLabel?: string;
};

export function ModelProviderChip({ modelId, onPress, accessibilityLabel }: Props) {
  const company = zenmuxModelCompany(modelId);
  const short = zenmuxChatModelShort(modelId);
  const sprite = buildCompanySprite(company.id as CompanyLogoKey, company.color);

  return (
    <Pressable
      style={({ pressed }) => [styles.chip, pressed && styles.chipPressed]}
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      <PixelSprite sprite={sprite} size={14} />
      <Text style={styles.label} numberOfLines={1}>
        {short}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 4,
    paddingVertical: 3,
  },
  chipPressed: {
    opacity: 0.55,
  },
  label: {
    fontSize: 11,
    fontWeight: '600',
    color: wechat.textPrimary,
    letterSpacing: 0.1,
  },
});
