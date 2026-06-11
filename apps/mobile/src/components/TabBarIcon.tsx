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

/** 流浪猫大脑:猫头(双耳) */
export function BrainTabIcon({ color, size = 24, focused }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M5 10.5c0-1.6.5-3 1.4-4.2L5.6 3.2c-.1-.5.4-.9.8-.6l3 1.9a8 8 0 0 1 5.2 0l3-1.9c.4-.3.9.1.8.6l-.8 3.1A6.8 6.8 0 0 1 19 10.5c0 4.2-3.1 7-7 7s-7-2.8-7-7Z"
        stroke={color}
        strokeWidth={focused ? 2 : 1.6}
        strokeLinejoin="round"
        fill={focused ? color : 'none'}
        fillOpacity={focused ? 0.15 : 0}
      />
      <Circle cx={9.5} cy={11} r={1} fill={color} />
      <Circle cx={14.5} cy={11} r={1} fill={color} />
      <Path d="M10.8 14h2.4l-1.2 1.4L10.8 14Z" fill={color} />
      <Path d="M12 17.5v3" stroke={color} strokeWidth={1.6} strokeLinecap="round" />
    </Svg>
  );
}
