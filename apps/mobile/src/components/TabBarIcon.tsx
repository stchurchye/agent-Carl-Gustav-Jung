import React from 'react';
import Svg, { Circle, Path } from 'react-native-svg';

/**
 * U8:底部 tab 图标(此前无 tabBarIcon,react-navigation 渲染 ▼ 占位符)。
 * 线条风格,颜色随 tabBarActiveTintColor/inactive 由 navigator 传入。
 */

type IconProps = { color: string; size?: number; focused?: boolean };

/** 工作室:对话气泡 */
export function StudioTabIcon({ color, size = 24, focused }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v8a2.5 2.5 0 0 1-2.5 2.5H9l-4 3.5V6.5Z"
        stroke={color}
        strokeWidth={focused ? 2 : 1.6}
        strokeLinejoin="round"
        fill={focused ? color : 'none'}
        fillOpacity={focused ? 0.15 : 0}
      />
      <Circle cx={9} cy={10.5} r={1} fill={color} />
      <Circle cx={12.5} cy={10.5} r={1} fill={color} />
      <Circle cx={16} cy={10.5} r={1} fill={color} />
    </Svg>
  );
}

/** my bow wow:狗头(垂耳+圆鼻+吐舌) */
export function DogTabIcon({ color, size = 24, focused }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M6 9.5C6 6.6 8.7 4.5 12 4.5s6 2.1 6 5c0 4-2.7 7.5-6 7.5s-6-3.5-6-7.5Z"
        stroke={color}
        strokeWidth={focused ? 2 : 1.6}
        strokeLinejoin="round"
        fill={focused ? color : 'none'}
        fillOpacity={focused ? 0.15 : 0}
      />
      <Path
        d="M6.3 6.3C4.7 7 3.7 9.1 4.2 11.4c.2.9 1.2 1.3 1.9.7"
        stroke={color}
        strokeWidth={focused ? 2 : 1.6}
        strokeLinecap="round"
      />
      <Path
        d="M17.7 6.3c1.6.7 2.6 2.8 2.1 5.1-.2.9-1.2 1.3-1.9.7"
        stroke={color}
        strokeWidth={focused ? 2 : 1.6}
        strokeLinecap="round"
      />
      <Circle cx={9.8} cy={10.3} r={1} fill={color} />
      <Circle cx={14.2} cy={10.3} r={1} fill={color} />
      <Path d="M10.9 12.8h2.2l-1.1 1.3-1.1-1.3Z" fill={color} />
      <Path
        d="M12 14.3v2c0 1 1.7 1 1.7 0v-.7"
        stroke={color}
        strokeWidth={1.6}
        strokeLinecap="round"
      />
    </Svg>
  );
}
