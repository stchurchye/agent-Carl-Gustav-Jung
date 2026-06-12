import type { PixelAvatarSettings } from './avatar/types.js';

export type GroupMemberRole = 'owner' | 'member';

export interface User {
  id: string;
  username: string;
  displayName: string;
  createdAt: string;
  /** 压缩后的展示头像（data URL） */
  avatarDisplayUrl?: string | null;
  /** Bow Wow 像素形象配置(狗+小人);null/缺省 = 未领养,客户端按 seed 兜底 */
  pixelAvatar?: PixelAvatarSettings | null;
}

export interface UserDisplayNameHistoryEntry {
  id: string;
  displayName: string;
  createdAt: string;
}

export interface UserAvatarHistoryEntry {
  id: string;
  displayUrl: string;
  originalUrl: string;
  mimeType: string;
  createdAt: string;
}

export interface UserProfileHistory {
  displayNames: UserDisplayNameHistoryEntry[];
  avatars: UserAvatarHistoryEntry[];
}

export interface UserAiProfile {
  userId: string;
  assistantName: string;
  stylePreset: string;
  styleCustom?: string | null;
  updatedAt: string;
}

export interface Group {
  id: string;
  name: string;
  inviteCode: string;
  ownerId: string;
  createdAt: string;
}

export interface GroupMember {
  groupId: string;
  userId: string;
  role: GroupMemberRole;
  displayName: string;
  joinedAt: string;
  /** 群里展示成员的狗/小人用;服务端 listGroupMembers 下发 */
  pixelAvatar?: PixelAvatarSettings | null;
}

export interface AuthTokens {
  accessToken: string;
  expiresIn: number;
}

export interface AuthLoginResult {
  user: User;
  tokens: AuthTokens;
}
