import { randomUUID } from 'crypto';
import type {
  User,
  UserAvatarHistoryEntry,
  UserDisplayNameHistoryEntry,
  UserProfileHistory,
  UserPersonaSettings,
} from '@xzz/shared';
import {
  isPersonaCustomized,
  mergeUserPersonaSettings,
  sanitizePixelAvatarSettings,
  sanitizeUserPersonaSettings,
  validateProfileDisplayName,
  type PixelAvatarSettings,
} from '@xzz/shared';
import { getPool } from '../db/client.js';

function now() {
  return new Date().toISOString();
}

function rowUser(row: {
  id: string;
  username: string;
  display_name: string;
  created_at: Date;
  avatar_display_key?: string | null;
  pixel_avatar?: unknown;
}): User {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    createdAt: row.created_at.toISOString(),
    avatarDisplayUrl: row.avatar_display_key ?? null,
    pixelAvatar: sanitizePixelAvatarSettings(row.pixel_avatar),
  };
}

const USER_SELECT = `id, username, display_name, created_at, avatar_display_key, pixel_avatar`;

export async function getUserById(userId: string): Promise<User | null> {
  const { rows } = await getPool().query(
    `SELECT ${USER_SELECT} FROM users WHERE id = $1`,
    [userId],
  );
  return rows[0] ? rowUser(rows[0]) : null;
}

export async function appendDisplayNameHistory(
  userId: string,
  displayName: string,
): Promise<void> {
  await getPool().query(
    `INSERT INTO user_display_name_history (id, user_id, display_name, created_at)
     VALUES ($1, $2, $3, $4)`,
    [randomUUID(), userId, displayName, now()],
  );
}

export async function updateUserDisplayName(
  userId: string,
  displayName: string,
): Promise<User | null> {
  const parsed = validateProfileDisplayName(displayName);
  if (!parsed.ok) return null;

  const current = await getUserById(userId);
  if (!current) return null;

  if (parsed.value === current.displayName) return current;

  await getPool().query(
    'UPDATE users SET display_name = $2 WHERE id = $1',
    [userId, parsed.value],
  );
  await appendDisplayNameHistory(userId, parsed.value);
  return getUserById(userId);
}

export async function updateUserAvatar(
  userId: string,
  input: {
    mimeType: string;
    originalDataUrl: string;
    displayDataUrl: string;
  },
): Promise<User | null> {
  const current = await getUserById(userId);
  if (!current) return null;

  const historyId = randomUUID();
  const createdAt = now();
  await getPool().query(
    `INSERT INTO user_avatar_history
       (id, user_id, original_storage_key, display_storage_key, mime_type, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      historyId,
      userId,
      input.originalDataUrl,
      input.displayDataUrl,
      input.mimeType,
      createdAt,
    ],
  );
  await getPool().query(
    `UPDATE users SET avatar_original_key = $2, avatar_display_key = $3 WHERE id = $1`,
    [userId, input.originalDataUrl, input.displayDataUrl],
  );
  return getUserById(userId);
}

export async function updateUserPixelAvatar(
  userId: string,
  settings: PixelAvatarSettings | null,
): Promise<User | null> {
  const current = await getUserById(userId);
  if (!current) return null;
  await getPool().query(`UPDATE users SET pixel_avatar = $2::jsonb WHERE id = $1`, [
    userId,
    settings ? JSON.stringify(settings) : null,
  ]);
  return getUserById(userId);
}

export async function getUserProfileHistory(
  userId: string,
  limit = 30,
): Promise<UserProfileHistory> {
  const cap = Math.min(Math.max(limit, 1), 50);
  const [names, avatars] = await Promise.all([
    getPool().query(
      `SELECT id, display_name, created_at FROM user_display_name_history
       WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [userId, cap],
    ),
    getPool().query(
      `SELECT id, display_storage_key, original_storage_key, mime_type, created_at
       FROM user_avatar_history
       WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [userId, cap],
    ),
  ]);

  const displayNames: UserDisplayNameHistoryEntry[] = names.rows.map((r) => ({
    id: r.id as string,
    displayName: r.display_name as string,
    createdAt: (r.created_at as Date).toISOString(),
  }));

  const avatarRows: UserAvatarHistoryEntry[] = avatars.rows.map((r) => ({
    id: r.id as string,
    displayUrl: r.display_storage_key as string,
    originalUrl: r.original_storage_key as string,
    mimeType: r.mime_type as string,
    createdAt: (r.created_at as Date).toISOString(),
  }));

  return { displayNames, avatars: avatarRows };
}

function rowPersonaSettings(raw: unknown): UserPersonaSettings {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return sanitizeUserPersonaSettings(raw as UserPersonaSettings);
}

async function legacyAiProfileToPersona(userId: string): Promise<UserPersonaSettings> {
  const { rows } = await getPool().query(
    'SELECT assistant_name, style_preset, style_custom, updated_at FROM user_ai_profiles WHERE user_id = $1',
    [userId],
  );
  const r = rows[0];
  if (!r) return {};
  const styleTags =
    r.style_preset === 'warm'
      ? '友好、温暖'
      : typeof r.style_preset === 'string' && r.style_preset.trim()
        ? r.style_preset.trim()
        : undefined;
  return sanitizeUserPersonaSettings({
    schemaVersion: 1,
    identity: {
      assistantName:
        typeof r.assistant_name === 'string' ? r.assistant_name.trim() : undefined,
      styleTags,
    },
    soul:
      typeof r.style_custom === 'string' && r.style_custom.trim()
        ? { tone: r.style_custom.trim() }
        : undefined,
    updatedAt:
      r.updated_at instanceof Date
        ? r.updated_at.toISOString()
        : undefined,
  });
}

export async function getPersonaSettings(userId: string): Promise<UserPersonaSettings> {
  const { rows } = await getPool().query(
    'SELECT persona_settings FROM users WHERE id = $1',
    [userId],
  );
  if (!rows[0]) return {};
  let settings = rowPersonaSettings(rows[0].persona_settings);
  if (!isPersonaCustomized(settings)) {
    const legacy = await legacyAiProfileToPersona(userId);
    if (isPersonaCustomized(legacy)) {
      settings = legacy;
      await getPool().query(
        `UPDATE users SET persona_settings = $2::jsonb WHERE id = $1`,
        [userId, JSON.stringify({ ...settings, updatedAt: now() })],
      );
    }
  }
  return settings;
}

export async function updatePersonaSettings(
  userId: string,
  patch: UserPersonaSettings,
): Promise<UserPersonaSettings> {
  const current = await getPersonaSettings(userId);
  const next = mergeUserPersonaSettings(current, patch);
  const updatedAt = now();
  const stored: UserPersonaSettings = { ...next, updatedAt };
  await getPool().query(
    `UPDATE users SET persona_settings = $2::jsonb WHERE id = $1`,
    [userId, JSON.stringify(stored)],
  );
  const assistantName = stored.identity?.assistantName;
  if (assistantName) {
    await getPool().query(
      `INSERT INTO user_ai_profiles (user_id, assistant_name, style_preset, style_custom, updated_at)
       VALUES ($1, $2, 'custom', $3, $4)
       ON CONFLICT (user_id) DO UPDATE SET
         assistant_name = EXCLUDED.assistant_name,
         style_custom = COALESCE(EXCLUDED.style_custom, user_ai_profiles.style_custom),
         updated_at = EXCLUDED.updated_at`,
      [userId, assistantName, stored.soul?.tone ?? null, updatedAt],
    );
  }
  return stored;
}
