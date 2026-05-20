import type {
  PersonaIdentity,
  PersonaSoul,
  PersonaUser,
  UserPersonaSettings,
} from './types.js';

export const PERSONA_ASSISTANT_NAME_MAX = 20;
export const PERSONA_STYLE_TAGS_MAX = 80;
export const PERSONA_EMOJI_MAX = 8;
export const PERSONA_SOUL_FIELD_MAX = 800;
export const PERSONA_USER_NAME_MAX = 20;
export const PERSONA_TIMEZONE_MAX = 64;
export const PERSONA_USER_BIO_MAX = 600;
export const PERSONA_USER_HABITS_MAX = 600;

function trimOptional(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const t = value.trim();
  if (!t) return undefined;
  return [...t].slice(0, max).join('');
}

function mergeSection<T extends Record<string, unknown>>(
  current: T | undefined,
  patch: Partial<T> | undefined,
): T | undefined {
  if (!patch) return current;
  const next = { ...(current ?? {}), ...patch } as T;
  const hasValue = Object.values(next).some(
    (v) => typeof v === 'string' && v.trim().length > 0,
  );
  return hasValue ? next : undefined;
}

export function sanitizePersonaIdentity(
  raw: PersonaIdentity | undefined,
): PersonaIdentity | undefined {
  if (!raw) return undefined;
  const assistantName = trimOptional(raw.assistantName, PERSONA_ASSISTANT_NAME_MAX);
  const styleTags = trimOptional(raw.styleTags, PERSONA_STYLE_TAGS_MAX);
  const emoji = trimOptional(raw.emoji, PERSONA_EMOJI_MAX);
  const out: PersonaIdentity = {};
  if (assistantName) out.assistantName = assistantName;
  if (styleTags) out.styleTags = styleTags;
  if (emoji) out.emoji = emoji;
  return Object.keys(out).length > 0 ? out : undefined;
}

export function sanitizePersonaSoul(raw: PersonaSoul | undefined): PersonaSoul | undefined {
  if (!raw) return undefined;
  const tone = trimOptional(raw.tone, PERSONA_SOUL_FIELD_MAX);
  const boundaries = trimOptional(raw.boundaries, PERSONA_SOUL_FIELD_MAX);
  const formatPrefs = trimOptional(raw.formatPrefs, PERSONA_SOUL_FIELD_MAX);
  const out: PersonaSoul = {};
  if (tone) out.tone = tone;
  if (boundaries) out.boundaries = boundaries;
  if (formatPrefs) out.formatPrefs = formatPrefs;
  return Object.keys(out).length > 0 ? out : undefined;
}

export function sanitizePersonaUser(raw: PersonaUser | undefined): PersonaUser | undefined {
  if (!raw) return undefined;
  const preferredName = trimOptional(raw.preferredName, PERSONA_USER_NAME_MAX);
  const timezone = trimOptional(raw.timezone, PERSONA_TIMEZONE_MAX);
  const bio = trimOptional(raw.bio, PERSONA_USER_BIO_MAX);
  const habits = trimOptional(raw.habits, PERSONA_USER_HABITS_MAX);
  const out: PersonaUser = {};
  if (preferredName) out.preferredName = preferredName;
  if (timezone) out.timezone = timezone;
  if (bio) out.bio = bio;
  if (habits) out.habits = habits;
  return Object.keys(out).length > 0 ? out : undefined;
}

export function sanitizeUserPersonaSettings(
  raw: UserPersonaSettings | undefined,
): UserPersonaSettings {
  if (!raw) return {};
  const identity = sanitizePersonaIdentity(raw.identity);
  const soul = sanitizePersonaSoul(raw.soul);
  const user = sanitizePersonaUser(raw.user);
  const hasAny = identity || soul || user;
  if (!hasAny) return {};
  return {
    schemaVersion: raw.schemaVersion ?? 1,
    identity,
    soul,
    user,
    updatedAt: raw.updatedAt,
  };
}

export function mergeUserPersonaSettings(
  current: UserPersonaSettings,
  patch: UserPersonaSettings,
): UserPersonaSettings {
  return sanitizeUserPersonaSettings({
    schemaVersion: patch.schemaVersion ?? current.schemaVersion ?? 1,
    identity: mergeSection(current.identity, patch.identity),
    soul: mergeSection(current.soul, patch.soul),
    user: mergeSection(current.user, patch.user),
    updatedAt: patch.updatedAt ?? current.updatedAt,
  });
}

export function isPersonaCustomized(settings: UserPersonaSettings | undefined): boolean {
  const s = sanitizeUserPersonaSettings(settings);
  return Boolean(s.identity || s.soul || s.user);
}

export function personaAssistantDisplayName(
  settings: UserPersonaSettings | undefined,
  fallback = '小助手',
): string {
  const name = settings?.identity?.assistantName?.trim();
  return name || fallback;
}

export function personaPreviewLine(
  settings: UserPersonaSettings | undefined,
  maxLen = 12,
): string {
  const parts: string[] = [];
  const id = settings?.identity;
  const soul = settings?.soul;
  const user = settings?.user;
  if (id?.assistantName) parts.push(id.assistantName);
  if (id?.styleTags) parts.push(id.styleTags);
  if (soul?.tone) parts.push(soul.tone);
  if (user?.preferredName) parts.push(user.preferredName);
  if (user?.bio) parts.push(user.bio);
  const joined = parts.join(' · ').replace(/\s+/g, ' ');
  if (!joined) return '';
  return joined.length <= maxLen ? joined : `${joined.slice(0, maxLen)}…`;
}
