/**
 * K 战役·修订三:记忆归属两轴规则。
 *
 * - **facts(个人事实)永远私有**:owner = 触发用户,不论私聊/群聊 —— 隐私底线。
 * - **findings(研究结论)群聊 run 进群组共享池**:owner = `group:{groupId}` 伪 owner
 *   (owner_id 是 Text 列,零 schema 改动)。家人在群里问"我们之前查过 X 吗"能命中
 *   任何成员触发过的研究;私聊 run 的 findings 仍归个人。
 *
 * 读侧对应规则(recall/预取):私聊 run 查个人池;群聊 run 查 个人池 + 群池 双池归并。
 */

export function groupPoolOwner(groupId: string): string {
  return `group:${groupId}`;
}

export function memoryPoolOwner(
  kind: 'fact' | 'finding',
  ownerId: string,
  channel: 'private' | 'group',
  groupId?: string | null,
): string {
  if (kind === 'finding' && channel === 'group' && groupId) {
    return groupPoolOwner(groupId);
  }
  return ownerId;
}
