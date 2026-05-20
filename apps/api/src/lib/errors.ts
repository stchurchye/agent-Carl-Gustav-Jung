import { errorMessages, ErrorCodes, type ErrorCode } from '@xzz/shared';
import type { Context } from 'hono';
import type { AppVariables } from '../types.js';

export class AppError extends Error {
  constructor(
    public code: ErrorCode,
    public status = 500,
    public hint?: string,
  ) {
    super(errorMessages[code].message);
  }
}

export function jsonError(c: Context<{ Variables: AppVariables }>, code: ErrorCode, status?: number) {
  const entry = errorMessages[code];
  const requestId = c.get('requestId') as string;
  return c.json(
    {
      ok: false,
      message: entry.message,
      hint: entry.hint,
      code,
      requestId,
      retryable: entry.retryable,
    },
    (status ?? (code === ErrorCodes.NOT_FOUND ? 404 : 500)) as 404 | 500,
  );
}
