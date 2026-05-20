import pg from 'pg';

const { Pool } = pg;

let pool: pg.Pool | null = null;

export function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error(
      '缺少 DATABASE_URL，API 无法启动。请运行 docker compose up -d postgres 并配置 .env',
    );
  }
  return url;
}

export function getPool(): pg.Pool {
  if (!pool) {
    pool = new Pool({ connectionString: requireDatabaseUrl() });
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
