const DEV_ORIGINS = [
  'http://localhost:8090',
  'http://127.0.0.1:8090',
  'exp://127.0.0.1:8090',
  'exp://localhost:8090',
];

export function parseCorsOrigins(): string[] {
  const raw = process.env.CORS_ORIGINS?.trim();
  if (!raw) {
    return process.env.NODE_ENV === 'production' ? [] : DEV_ORIGINS;
  }
  if (raw === '*') return ['*'];
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

/** 无 Origin 的请求（原生 App、curl）始终放行；浏览器跨域需命中白名单 */
export function isCorsOriginAllowed(origin: string | undefined, allowed: string[]): boolean {
  if (!origin) return true;
  if (allowed.includes('*')) return true;
  return allowed.includes(origin);
}
