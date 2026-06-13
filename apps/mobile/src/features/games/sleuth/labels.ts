import { zh } from '../../../locales/zh-CN';
import type { SniffAttr } from './engine';

/** 维度 → 取值中文表(accessoryColor 复用 accentNames) */
const VALUE_NAMES: Record<SniffAttr, Record<string, string>> = {
  body: zh.pixelAvatar.bodyNames,
  coat: zh.pixelAvatar.coatNames,
  pattern: zh.pixelAvatar.patternNames,
  ears: zh.pixelAvatar.earsNames,
  tail: zh.pixelAvatar.tailNames,
  accessory: zh.pixelAvatar.accessoryNames,
  accessoryColor: zh.pixelAvatar.accentNames,
  personality: zh.pixelAvatar.personalityNames,
};

/** 维度中文名(体型/毛色/…) */
export function attrLabel(attr: SniffAttr): string {
  return zh.pixelAvatar.dims[attr];
}

/** 取值中文名(立耳/麦芽/…);未知取值兜底返回原值 */
export function valueLabel(attr: SniffAttr, value: string): string {
  return VALUE_NAMES[attr][value] ?? value;
}
