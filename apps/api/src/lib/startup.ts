const WEAK_JWT_SECRETS = new Set([
  'xzz_local_dev_jwt_secret',
  'xzz-dev-jwt-secret-change-in-production',
  '请换成随机长字符串',
]);

/** 生产环境启动前校验关键配置 */
export function assertProductionConfig(): void {
  if (process.env.NODE_ENV !== 'production') return;

  const secret = process.env.JWT_SECRET?.trim();
  if (!secret) {
    throw new Error(
      '生产环境必须设置 JWT_SECRET（在 .env 中配置，可用 openssl rand -base64 32 生成）',
    );
  }
  if (WEAK_JWT_SECRETS.has(secret) || secret.length < 32) {
    throw new Error('JWT_SECRET 过弱：请使用至少 32 字符的随机字符串，勿用示例或默认值');
  }
}
