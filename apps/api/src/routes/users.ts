import { Hono } from 'hono';
import {
  ErrorCodes,
  PROFILE_AVATAR_ORIGINAL_MAX_BYTES,
  sanitizePixelAvatarSettings,
  type UserPersonaSettings,
} from '@xzz/shared';
import type { AppVariables } from '../types.js';
import { jsonError } from '../lib/errors.js';
import { signAccessToken } from '../lib/auth.js';
import { requireAuth } from '../middleware/auth.js';
import * as pg from '../store/pg.js';
import * as profilePg from '../store/pg-profile.js';

export const usersRouter = new Hono<{ Variables: AppVariables }>();

usersRouter.use('*', requireAuth);

usersRouter.get('/me/ai-profile', async (c) => {
  const profile = await pg.getUserAiProfile(c.get('userId')!);
  return c.json({ ok: true, data: profile, requestId: c.get('requestId') });
});

usersRouter.patch('/me/ai-profile', async (c) => {
  const body = await c.req.json<{
    assistantName?: string;
    stylePreset?: string;
    styleCustom?: string | null;
  }>();
  const userId = c.get('userId')!;
  const patch: UserPersonaSettings = {
    identity: body.assistantName?.trim()
      ? { assistantName: body.assistantName.trim() }
      : undefined,
    soul:
      body.styleCustom?.trim() || body.stylePreset?.trim()
        ? {
            tone: body.styleCustom?.trim() || undefined,
            boundaries: undefined,
          }
        : undefined,
  };
  if (body.stylePreset?.trim() && !patch.identity) {
    patch.identity = {
      styleTags:
        body.stylePreset === 'warm' ? '友好、温暖' : body.stylePreset.trim(),
    };
  } else if (body.stylePreset?.trim()) {
    patch.identity = {
      ...patch.identity,
      styleTags:
        body.stylePreset === 'warm' ? '友好、温暖' : body.stylePreset.trim(),
    };
  }
  const persona = await profilePg.updatePersonaSettings(userId, patch);
  const profile = await pg.getUserAiProfile(userId);
  return c.json({ ok: true, data: profile, persona, requestId: c.get('requestId') });
});

usersRouter.get('/me/persona', async (c) => {
  const data = await profilePg.getPersonaSettings(c.get('userId')!);
  return c.json({ ok: true, data, requestId: c.get('requestId') });
});

usersRouter.patch('/me/persona', async (c) => {
  const body = await c.req.json<UserPersonaSettings>();
  const data = await profilePg.updatePersonaSettings(c.get('userId')!, body);
  return c.json({ ok: true, data, requestId: c.get('requestId') });
});

usersRouter.patch('/me', async (c) => {
  const userId = c.get('userId')!;
  const body = await c.req.json<{ displayName?: string }>();
  if (body.displayName === undefined) {
    return jsonError(c, ErrorCodes.VALIDATION, 400);
  }
  const user = await profilePg.updateUserDisplayName(userId, body.displayName);
  if (!user) return jsonError(c, ErrorCodes.VALIDATION, 400);
  const tokens = await signAccessToken(user);
  return c.json({ ok: true, data: { user, tokens }, requestId: c.get('requestId') });
});

usersRouter.post('/me/avatar', async (c) => {
  const userId = c.get('userId')!;
  const body = await c.req.json<{
    mimeType?: string;
    originalDataUrl?: string;
    displayDataUrl?: string;
  }>();
  const mimeType = body.mimeType?.trim() || 'image/jpeg';
  const originalDataUrl = body.originalDataUrl?.trim();
  const displayDataUrl = body.displayDataUrl?.trim();
  if (!originalDataUrl?.startsWith('data:') || !displayDataUrl?.startsWith('data:')) {
    return jsonError(c, ErrorCodes.VALIDATION, 400);
  }
  if (originalDataUrl.length > PROFILE_AVATAR_ORIGINAL_MAX_BYTES * 1.4) {
    return jsonError(c, ErrorCodes.VALIDATION, 413);
  }
  const user = await profilePg.updateUserAvatar(userId, {
    mimeType,
    originalDataUrl,
    displayDataUrl,
  });
  if (!user) return jsonError(c, ErrorCodes.NOT_FOUND, 404);
  const tokens = await signAccessToken(user);
  return c.json({ ok: true, data: { user, tokens }, requestId: c.get('requestId') });
});

usersRouter.put('/me/pixel-avatar', async (c) => {
  const userId = c.get('userId')!;
  const body = await c.req.json<{ pixelAvatar?: unknown }>();
  if (body.pixelAvatar === null) {
    const cleared = await profilePg.updateUserPixelAvatar(userId, null);
    if (!cleared) return jsonError(c, ErrorCodes.NOT_FOUND, 404);
    return c.json({ ok: true, data: { user: cleared }, requestId: c.get('requestId') });
  }
  const sanitized = sanitizePixelAvatarSettings(body.pixelAvatar);
  if (!sanitized) return jsonError(c, ErrorCodes.VALIDATION, 400);
  const user = await profilePg.updateUserPixelAvatar(userId, sanitized);
  if (!user) return jsonError(c, ErrorCodes.NOT_FOUND, 404);
  return c.json({ ok: true, data: { user }, requestId: c.get('requestId') });
});

usersRouter.get('/me/profile-history', async (c) => {
  const userId = c.get('userId')!;
  const data = await profilePg.getUserProfileHistory(userId);
  return c.json({ ok: true, data, requestId: c.get('requestId') });
});
