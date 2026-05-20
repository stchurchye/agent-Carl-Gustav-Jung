/** 微信昵称：1–20 个字符（含中文，按 Unicode 码点计） */
export const PROFILE_DISPLAY_NAME_MIN = 1;
export const PROFILE_DISPLAY_NAME_MAX = 20;

/** 微信聊天列表头像边长约 132px */
export const PROFILE_AVATAR_DISPLAY_PX = 132;

/** 展示用 JPEG 压缩质量（对齐微信观感） */
export const PROFILE_AVATAR_DISPLAY_QUALITY = 0.72;

/** 原图上传上限（约 2MB，与微信相近） */
export const PROFILE_AVATAR_ORIGINAL_MAX_BYTES = 2 * 1024 * 1024;

export type ProfileDisplayNameError = 'empty' | 'too_long';

export function profileDisplayNameLength(name: string): number {
  return [...name.trim()].length;
}

export function validateProfileDisplayName(
  name: string,
): { ok: true; value: string } | { ok: false; error: ProfileDisplayNameError } {
  const value = name.trim().replace(/\s+/g, ' ');
  const len = profileDisplayNameLength(value);
  if (len < PROFILE_DISPLAY_NAME_MIN) return { ok: false, error: 'empty' };
  if (len > PROFILE_DISPLAY_NAME_MAX) return { ok: false, error: 'too_long' };
  return { ok: true, value };
}
