import { useMemo } from 'react';
import Svg, { Path } from 'react-native-svg';
import { compileSprite, pathForRuns } from '../../../pixel/compile';
import { SCENE_COLORS, SCENE_GRIDS, SCENE_H, SCENE_W } from '../../../pixel/grids/dramaScenes';

/** 全像素场景背景:大画布编译成 SVG,满铺铺在演员狗背后(slice 覆盖,保持像素比例) */
export function SceneBackground({ bg }: { bg: string }) {
  const grid = SCENE_GRIDS[bg] ?? SCENE_GRIDS.hall;
  const compiled = useMemo(() => compileSprite(grid, SCENE_COLORS), [grid]);
  return (
    <Svg
      width="100%"
      height="100%"
      viewBox={`0 0 ${SCENE_W} ${SCENE_H}`}
      preserveAspectRatio="xMidYMid slice"
      testID={`scene-${bg}`}
    >
      {compiled.layers.map((l) => (
        <Path key={l.color} d={pathForRuns(l.runs)} fill={l.color} />
      ))}
    </Svg>
  );
}
