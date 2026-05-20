import type { UserPersonaSettings } from '@xzz/shared';

export function personaSectionPreview(
  parts: (string | undefined)[],
  maxLen = 12,
  fallback: string,
): string {
  const first = parts.map((p) => p?.trim()).find(Boolean);
  if (!first) return fallback;
  return first.length <= maxLen ? first : `${first.slice(0, maxLen)}…`;
}

export function identityPreview(settings: UserPersonaSettings, fallback: string): string {
  const id = settings.identity;
  return personaSectionPreview(
    [id?.assistantName, id?.styleTags, id?.emoji],
    12,
    fallback,
  );
}

export function soulPreview(settings: UserPersonaSettings, fallback: string): string {
  const soul = settings.soul;
  return personaSectionPreview(
    [soul?.tone, soul?.boundaries, soul?.formatPrefs],
    12,
    fallback,
  );
}

export function userPreview(settings: UserPersonaSettings, fallback: string): string {
  const user = settings.user;
  return personaSectionPreview(
    [user?.preferredName, user?.bio, user?.habits, user?.timezone],
    12,
    fallback,
  );
}
