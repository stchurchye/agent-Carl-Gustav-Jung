import { expect, it, beforeAll } from 'vitest';
import { describeDb } from '../../testUtils/dbGuard.js';
import { Hono } from 'hono';
import { runMigrations } from '../../db/migrate.js';
import { usersRouter } from '../users.js';
import { ensureUser, ensureGroup, addMember } from '../../lib/agent/__tests__/_groupFixture.js';
import { signAccessToken } from '../../lib/auth.js';
import { getUserById } from '../../store/pg-profile.js';
import { listGroupMembers } from '../../store/pg.js';
import type { AppVariables } from '../../types.js';

function makeApp() {
  return new Hono<{ Variables: AppVariables }>().route('/api/users', usersRouter);
}

async function putPixelAvatar(token: string, body: unknown) {
  const app = makeApp();
  return app.fetch(
    new Request('http://x/api/users/me/pixel-avatar', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

describeDb('PUT /api/users/me/pixel-avatar + 群成员下发', () => {
  beforeAll(async () => await runMigrations());

  it('合法配置入库并随 user 返回;getUserById 能读回', async () => {
    const user = await ensureUser('pix-a');
    const { accessToken } = await signAccessToken(user);
    const res = await putPixelAvatar(accessToken, {
      pixelAvatar: {
        v: 1,
        dog: {
          body: 'long',
          coat: 'malt',
          pattern: 'socks',
          ears: 'pointy',
          tail: 'stub',
          accessory: 'bandana',
          accessoryColor: 'brick',
          personality: 'sweet',
        },
        human: { skin: 'tan', hair: 'bob', hairColor: 'ink', outfit: 'gold' },
      },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { user: { pixelAvatar: { dog: { coat: string } } } } };
    expect(json.data.user.pixelAvatar.dog.coat).toBe('malt');

    const fetched = await getUserById(user.id);
    expect(fetched?.pixelAvatar?.dog.body).toBe('long');
    expect(fetched?.pixelAvatar?.human.hair).toBe('bob');
  });

  it('非法枚举被 sanitize 回退默认,未知键剥掉', async () => {
    const user = await ensureUser('pix-b');
    const { accessToken } = await signAccessToken(user);
    const res = await putPixelAvatar(accessToken, {
      pixelAvatar: { v: 9, dog: { body: 'huge', ears: 'fold', hack: true } },
    });
    expect(res.status).toBe(200);
    const fetched = await getUserById(user.id);
    expect(fetched?.pixelAvatar?.dog.body).toBe('sturdy'); // DEFAULT_DOG.body
    expect(fetched?.pixelAvatar?.dog.ears).toBe('fold');
    expect((fetched?.pixelAvatar?.dog as Record<string, unknown>).hack).toBeUndefined();
  });

  it('pixelAvatar: null 清除配置', async () => {
    const user = await ensureUser('pix-c');
    const { accessToken } = await signAccessToken(user);
    await putPixelAvatar(accessToken, { pixelAvatar: { v: 1 } });
    const res = await putPixelAvatar(accessToken, { pixelAvatar: null });
    expect(res.status).toBe(200);
    const fetched = await getUserById(user.id);
    expect(fetched?.pixelAvatar ?? null).toBeNull();
  });

  it('非对象(字符串)→ 400', async () => {
    const user = await ensureUser('pix-d');
    const { accessToken } = await signAccessToken(user);
    const res = await putPixelAvatar(accessToken, { pixelAvatar: '柴犬' });
    expect(res.status).toBe(400);
  });

  it('species=cat(德文卷毛猫)配置入库读回;非法品种回退 devonrex', async () => {
    const user = await ensureUser('pix-cat');
    const { accessToken } = await signAccessToken(user);
    const res = await putPixelAvatar(accessToken, {
      pixelAvatar: {
        v: 1,
        species: 'cat',
        cat: { breed: 'persian', coat: 'snow', accessory: 'bell', accessoryColor: 'teal', personality: 'playful' },
      },
    });
    expect(res.status).toBe(200);
    const fetched = await getUserById(user.id);
    expect(fetched?.pixelAvatar?.species).toBe('cat');
    expect(fetched?.pixelAvatar?.cat?.breed).toBe('devonrex');
    expect(fetched?.pixelAvatar?.cat?.coat).toBe('snow');
    expect(fetched?.pixelAvatar?.cat?.personality).toBe('playful');
  });

  it('listGroupMembers 下发各成员 pixelAvatar(群里别人能看到我的狗)', async () => {
    const owner = await ensureUser('pix-owner');
    const friend = await ensureUser('pix-friend');
    const { groupId } = await ensureGroup(owner.id);
    await addMember(groupId, friend.id);

    const { accessToken } = await signAccessToken(friend);
    await putPixelAvatar(accessToken, {
      pixelAvatar: { v: 1, dog: { coat: 'ebony', personality: 'calm' } },
    });

    const members = await listGroupMembers(owner.id, groupId);
    const friendRow = members?.find((m) => m.userId === friend.id);
    expect(friendRow?.pixelAvatar?.dog.coat).toBe('ebony');
    const ownerRow = members?.find((m) => m.userId === owner.id);
    expect(ownerRow?.pixelAvatar ?? null).toBeNull();
  });
});
