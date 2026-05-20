export function log(
  level: 'info' | 'warn' | 'error',
  message: string,
  meta?: Record<string, unknown>,
) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    message,
    ...meta,
  };
  const line = JSON.stringify(entry);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}
