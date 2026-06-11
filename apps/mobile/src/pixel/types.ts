/** 像素精灵编译类型。字符画布 → 同色行程 → SVG Path,渲染层零计算。 */

/** 字符画布:每行一个字符串,'.' = 透明,其余字符为语义角色(B 毛色/S 暗部/I 描边…) */
export type PixelGrid = string[];

/** 一段水平连续同色像素 */
export type Run = { x: number; y: number; w: number };

export type CompiledLayer = { color: string; runs: Run[] };

export type CompiledSprite = {
  /** 网格边长(格数);viewBox 用 0 0 size size */
  size: number;
  layers: CompiledLayer[];
};

/**
 * 一个角色。base 不含眼/嘴/尾;眼嘴尾各是一对可切换的稀疏叠层(帧盖不掉底色,
 * 所以可变部位必须从 base 抠掉、用整对帧切 opacity)。still = 全 idle 合成,静态头像用单 Svg。
 */
export type CompiledCharacter = {
  size: number;
  still: CompiledSprite;
  base: CompiledSprite;
  eyesOpen: CompiledSprite;
  eyesClosed: CompiledSprite;
  mouthIdle: CompiledSprite;
  mouthTalk: CompiledSprite;
  tailIdle?: CompiledSprite;
  tailWag?: CompiledSprite;
};

/** 性格驱动的动画参数(ms) */
export type CharacterMotion = {
  blinkMinMs: number;
  blinkMaxMs: number;
  /** 摇尾帧翻转周期;0 = 不摇 */
  wagMs: number;
  /** 说话弹跳幅度(相对 size 的比例) */
  bounceRatio: number;
};
