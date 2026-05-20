/** 401 / 登录失效时由 api 层触发，AuthGate 注册后清会话并回到登录页 */
let onUnauthorized: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

let notifying = false;

export function notifyUnauthorized(): void {
  if (notifying) return;
  notifying = true;
  onUnauthorized?.();
  setTimeout(() => {
    notifying = false;
  }, 3000);
}

export function isAuthErrorMessage(message: string): boolean {
  return /请先登录|登录后再继续|登录状态|未授权|AUTH_UNAUTHORIZED/i.test(message);
}
