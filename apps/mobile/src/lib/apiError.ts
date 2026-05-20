/** 从 API 抛出的 Error 里取出对用户友好的说明 */
export function apiErrorText(e: unknown): { message: string; hint?: string } {
  if (e instanceof Error) {
    const err = e as Error & { hint?: string };
    return {
      message: err.message || '出了点小问题，请稍后再试',
      hint: err.hint,
    };
  }
  return { message: '出了点小问题，请稍后再试' };
}
