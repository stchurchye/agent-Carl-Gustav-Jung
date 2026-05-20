import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';
import type { User } from '@xzz/shared';

const JWT_ISSUER = 'xzz-api';
const JWT_AUDIENCE = 'xzz-mobile';
const DEFAULT_EXPIRES_SEC = 7 * 24 * 60 * 60;

export function getJwtSecret(): Uint8Array {
  const secret =
    process.env.JWT_SECRET?.trim() ||
    (process.env.NODE_ENV === 'production'
      ? ''
      : 'xzz-dev-jwt-secret-change-in-production');
  if (!secret) {
    throw new Error('生产环境必须设置 JWT_SECRET');
  }
  return new TextEncoder().encode(secret);
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function signAccessToken(user: User): Promise<{
  accessToken: string;
  expiresIn: number;
}> {
  const expiresIn = Number(process.env.JWT_EXPIRES_SEC ?? DEFAULT_EXPIRES_SEC);
  const accessToken = await new SignJWT({
    username: user.username,
    displayName: user.displayName,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${expiresIn}s`)
    .sign(getJwtSecret());
  return { accessToken, expiresIn };
}

export async function verifyAccessToken(
  token: string,
): Promise<{ userId: string; username: string; displayName: string }> {
  const { payload } = await jwtVerify(token, getJwtSecret(), {
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  });
  const userId = payload.sub;
  if (!userId) throw new Error('invalid token');
  return {
    userId,
    username: String(payload.username ?? ''),
    displayName: String(payload.displayName ?? ''),
  };
}
