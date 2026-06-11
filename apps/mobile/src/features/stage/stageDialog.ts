import type { StageActor, StageDialog, StageLine } from './stageTypes';

/**
 * "一次一条"状态机:current = 最新非 system 行;previous = 向前第一条不同 actor 的行。
 * 私聊自然退化为"双方各一条";完全由 messages 派生,无命令式队列。
 */
export function selectStageDialog(lines: StageLine[]): StageDialog {
  let current: StageLine | null = null;
  let previous: StageLine | null = null;
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i];
    if (l.kind === 'system') continue;
    if (!current) {
      current = l;
      continue;
    }
    if (l.actorId !== current.actorId) {
      previous = l;
      break;
    }
  }
  return { current, previous };
}

export type ArrangedActors = {
  visible: StageActor[];
  overflow: StageActor[];
};

/**
 * 站位:按"最近发言新近度"取前 maxSlots(没发过言的按注册顺序排最后),
 * 然后把可见的狗挪到主人右边一格(像素狗跟主人站)。纯函数、稳定。
 */
export function arrangeActors(
  actors: StageActor[],
  lines: StageLine[],
  maxSlots: number,
): ArrangedActors {
  const lastSpokeIdx = new Map<string, number>();
  lines.forEach((l, i) => {
    if (l.kind !== 'system') lastSpokeIdx.set(l.actorId, i);
  });
  const order = actors
    .map((a, registerIdx) => ({ a, registerIdx, spoke: lastSpokeIdx.get(a.id) ?? -1 }))
    .sort((x, y) => (y.spoke - x.spoke) || (x.registerIdx - y.registerIdx));

  const visible = order.slice(0, maxSlots).map((o) => o.a);
  const overflow = order.slice(maxSlots).map((o) => o.a);

  // 狗贴主人:两者都可见时,把狗移动到主人后一位
  for (const dog of [...visible]) {
    if (!dog.ownerActorId) continue;
    const ownerIdx = visible.findIndex((a) => a.id === dog.ownerActorId);
    if (ownerIdx < 0) continue;
    const dogIdx = visible.indexOf(dog);
    if (dogIdx === ownerIdx + 1) continue;
    visible.splice(dogIdx, 1);
    const insertAt = visible.findIndex((a) => a.id === dog.ownerActorId) + 1;
    visible.splice(insertAt, 0, dog);
  }
  return { visible, overflow };
}
