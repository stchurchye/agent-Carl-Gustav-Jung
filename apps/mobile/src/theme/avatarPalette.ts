/**
 * U9:头像取色板(原 ChatAvatar/StudioAvatar 各写一份 Material 8 色,重复且与
 * Claude 暖调不和谐)。统一为暖调 8 色,白字对比全部 ≥4.2:1(已逐色核算)。
 */
export const avatarPalette = [
  '#C15F3C', // 赤陶
  '#5A7340', // 橄榄
  '#576B95', // 青蓝
  '#8D6E63', // 暖棕
  '#8F6000', // 深金
  '#7E5A8C', // 梅紫
  '#2F7D6D', // 深青
  '#B3542F', // 砖红
] as const;
