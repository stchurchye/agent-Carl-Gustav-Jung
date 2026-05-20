import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireDatabaseUrl, closePool } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { hashPassword } from '../lib/auth.js';
import * as pg from '../store/pg.js';
import * as profilePg from '../store/pg-profile.js';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const CHURCH_AVATAR_PATH = join(scriptDir, '../assets/seed/church-avatar.png');

function loadChurchAvatarDataUrl(): string {
  const buf = readFileSync(CHURCH_AVATAR_PATH);
  return `data:image/png;base64,${buf.toString('base64')}`;
}

async function applyDemoProfile(userId: string, displayName: string): Promise<void> {
  await profilePg.updateUserDisplayName(userId, displayName);
  const dataUrl = loadChurchAvatarDataUrl();
  await profilePg.updateUserAvatar(userId, {
    mimeType: 'image/png',
    originalDataUrl: dataUrl,
    displayDataUrl: dataUrl,
  });
}

async function main() {
  requireDatabaseUrl();
  await runMigrations();

  const username = process.env.SEED_USERNAME?.trim().toLowerCase() || 'demo';
  const password = process.env.SEED_PASSWORD ?? 'demo1234';
  const displayName = process.env.SEED_DISPLAY_NAME?.trim() || 'church';

  const existing = await pg.findUserByUsername(username);
  if (existing) {
    await applyDemoProfile(existing.id, displayName);
    await pg.seedDemoForUser(existing.id);
    console.log(`已更新演示用户：${username} / ${password}，昵称 ${displayName}`);
    return;
  }

  const passwordHash = await hashPassword(password);
  const user = await pg.createUser({ username, passwordHash, displayName });
  await applyDemoProfile(user.id, displayName);
  await pg.seedDemoForUser(user.id);
  console.log(`已创建演示用户：${username} / ${password}，昵称 ${displayName}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => closePool());
