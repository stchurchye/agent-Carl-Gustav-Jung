export type GroupMemberRole = 'owner' | 'member';

export interface User {
  id: string;
  username: string;
  displayName: string;
  createdAt: string;
  /** 压缩后的展示头像（data URL） */
  avatarDisplayUrl?: string | null;
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
}

export interface AuthTokens {
  accessToken: string;
  expiresIn: number;
}

export interface AuthLoginResult {
  user: User;
  tokens: AuthTokens;
}
