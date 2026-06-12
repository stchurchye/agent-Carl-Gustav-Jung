import { StyleSheet, Text, View } from 'react-native';
import { useMemo } from 'react';
import { presetDogForSeed } from '@xzz/shared';
import { PixelCharacter } from './pixel/PixelCharacter';
import { buildDogCharacter } from '../pixel/buildDog';
import { PERSONALITY_MOTION } from '../pixel/palette';
import { brainTokens } from '../theme/brainTokens';

const BRAND_DOG = presetDogForSeed('bowwow').dog;

export function BootSplash() {
  const character = useMemo(() => buildDogCharacter(BRAND_DOG), []);

  return (
    <View style={styles.page}>
      <View style={styles.content}>
        <View style={styles.dogWrap}>
          <PixelCharacter
            character={character}
            size={88}
            motion={PERSONALITY_MOTION[BRAND_DOG.personality]}
            animated
          />
        </View>
        <Text style={styles.appName}>bow wow</Text>
        <Text style={styles.tagline}>know everything you told</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: '#F4EFE4', // 与 app.json splash.backgroundColor 一致，原生→JS 切换无色差
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    alignItems: 'center',
    gap: 0,
  },
  dogWrap: {
    marginBottom: 24,
  },
  appName: {
    fontSize: 32,
    fontWeight: '800',
    color: brainTokens.accent,
    letterSpacing: -0.5,
    marginBottom: 8,
  },
  tagline: {
    fontSize: 14,
    fontWeight: '400',
    color: '#8A8070',
    letterSpacing: 0.3,
  },
});
