import type { DogConfig } from '@xzz/shared';

/**
 * 当前用户的狗形象 + 狗名 + 对用户的称呼,模块级快照。
 * 给「不在 AuthGate 上下文里」的全局组件用(如 AppAlertDialog——它挂在 AuthGate 之外)。
 * 由 AuthGate 在 user 变化时水合(狗形象即时取自 user.pixelAvatar,狗名/称呼异步拉 persona)。
 */
export type PersonaSnapshot = {
  dog: DogConfig | null;
  dogName: string;
  callMe: string;
};

let snap: PersonaSnapshot = { dog: null, dogName: 'Bow Wow', callMe: '' };

export function getPersonaSnapshot(): PersonaSnapshot {
  return snap;
}

export function setPersonaSnapshot(patch: Partial<PersonaSnapshot>): void {
  snap = { ...snap, ...patch };
}
