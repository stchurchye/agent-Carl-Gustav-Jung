import React from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { pathForRuns } from '../../pixel/compile';
import type { CompiledSprite } from '../../pixel/types';

type Props = {
  sprite: CompiledSprite;
  size: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/** 编译精灵 → 单 Svg(每色一条 Path)。静态头像/帧叠层共用,务必保持 memo。 */
export const PixelSprite = React.memo(function PixelSprite({ sprite, size, style, testID }: Props) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox={`0 0 ${sprite.size} ${sprite.size}`}
      style={style}
      testID={testID}
    >
      {sprite.layers.map((l) => (
        <Path key={l.color} d={pathForRuns(l.runs)} fill={l.color} />
      ))}
    </Svg>
  );
});
