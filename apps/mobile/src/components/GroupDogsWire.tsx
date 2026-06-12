import { StyleSheet, Text, View } from 'react-native';
import { useMemo } from 'react';
import { presetDogForSeed, type GroupMember } from '@xzz/shared';
import { PixelSprite } from './pixel/PixelSprite';
import { buildCatCharacter } from '../pixel/buildCat';
import { buildDogCharacter } from '../pixel/buildDog';
import { INK } from '../pixel/palette';
import { brainTokens } from '../theme/brainTokens';

const MAX_SHOWN = 4;

function memberStill(m: GroupMember) {
  const s = m.pixelAvatar;
  if (s?.species === 'cat' && s.cat) return buildCatCharacter(s.cat).still;
  return buildDogCharacter(s?.dog ?? presetDogForSeed(m.userId).dog).still;
}

/** 狗与狗之间的一小段像素电话线:点-亮点-点 */
function WireSegment() {
  return (
    <View style={styles.wire}>
      <View style={styles.wireDot} />
      <View style={[styles.wireDot, styles.wireDotLive]} />
      <View style={styles.wireDot} />
    </View>
  );
}

/**
 * 「Bow Wow 和他们的朋友们」入口:组里成员的狗排排站,
 * 狗与狗之间用像素电话线连着(通话中的汪星网络)。最多显示 4 只,多余 +N。
 */
export function GroupDogsWire({ members, size = 34 }: { members: GroupMember[]; size?: number }) {
  const stills = useMemo(() => members.slice(0, MAX_SHOWN).map(memberStill), [members]);
  const extra = members.length - stills.length;

  return (
    <View style={styles.row}>
      {stills.map((sprite, i) => (
        <View key={members[i]?.userId ?? i} style={styles.item}>
          {i > 0 ? <WireSegment /> : null}
          <PixelSprite sprite={sprite} size={size} />
        </View>
      ))}
      {extra > 0 ? <Text style={styles.extra}>+{extra}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  wire: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginHorizontal: 4,
  },
  wireDot: {
    width: 4,
    height: 4,
    backgroundColor: INK,
    opacity: 0.45,
  },
  wireDotLive: {
    backgroundColor: brainTokens.accent,
    opacity: 1,
  },
  extra: {
    marginLeft: 6,
    fontSize: 12,
    fontWeight: '700',
    color: brainTokens.textMuted,
  },
});
