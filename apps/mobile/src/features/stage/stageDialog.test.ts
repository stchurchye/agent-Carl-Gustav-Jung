import type { StageActor, StageLine } from './stageTypes';
import { arrangeActors, selectStageDialog } from './stageDialog';

const line = (id: string, actorId: string, kind: StageLine['kind'] = 'chat'): StageLine => ({
  id,
  actorId,
  kind,
  text: id,
  createdAt: id,
});

const actor = (id: string, kind: StageActor['kind'] = 'human', ownerActorId?: string): StageActor => ({
  id,
  kind,
  name: id,
  seed: id,
  ownerActorId,
});

describe('selectStageDialog 一次一条', () => {
  it('空列表 → 双 null', () => {
    expect(selectStageDialog([])).toEqual({ current: null, previous: null });
  });

  it('current=最新非 system,previous=向前第一条不同 actor', () => {
    const lines = [line('1', 'dog:self'), line('2', 'user:a'), line('3', 'dog:self')];
    const d = selectStageDialog(lines);
    expect(d.current?.id).toBe('3');
    expect(d.previous?.id).toBe('2');
  });

  it('用户连发多条:current 是最新一条,previous 跨 actor 找', () => {
    const lines = [line('1', 'dog:self'), line('2', 'user:a'), line('3', 'user:a')];
    const d = selectStageDialog(lines);
    expect(d.current?.id).toBe('3');
    expect(d.previous?.id).toBe('1');
  });

  it('system 行不上舞台(current/previous 都跳过)', () => {
    const lines = [line('1', 'user:a'), line('2', 'system', 'system'), line('3', 'system', 'system')];
    const d = selectStageDialog(lines);
    expect(d.current?.id).toBe('1');
    expect(d.previous).toBeNull();
  });

  it('全场只有一个 actor → previous null', () => {
    expect(selectStageDialog([line('1', 'user:a'), line('2', 'user:a')]).previous).toBeNull();
  });
});

describe('arrangeActors 站位', () => {
  it('按最近发言新近度排,超出 maxSlots 进 overflow', () => {
    const actors = [actor('user:a'), actor('user:b'), actor('user:c')];
    const lines = [line('1', 'user:a'), line('2', 'user:c')];
    const r = arrangeActors(actors, lines, 2);
    expect(r.visible.map((a) => a.id)).toEqual(['user:c', 'user:a']);
    expect(r.overflow.map((a) => a.id)).toEqual(['user:b']);
  });

  it('没发过言的按原始顺序排在最后', () => {
    const actors = [actor('user:a'), actor('user:b')];
    const r = arrangeActors(actors, [], 4);
    expect(r.visible.map((a) => a.id)).toEqual(['user:a', 'user:b']);
  });

  it('狗紧跟主人站(两者都可见时)', () => {
    const actors = [actor('user:a'), actor('dog:a', 'dog', 'user:a'), actor('user:b')];
    const lines = [line('1', 'dog:a'), line('2', 'user:b'), line('3', 'user:a')];
    const r = arrangeActors(actors, lines, 3);
    const ids = r.visible.map((a) => a.id);
    expect(ids.indexOf('dog:a')).toBe(ids.indexOf('user:a') + 1);
  });

  it('同输入同输出(稳定)', () => {
    const actors = [actor('user:a'), actor('user:b')];
    const lines = [line('1', 'user:b')];
    expect(arrangeActors(actors, lines, 2)).toEqual(arrangeActors(actors, lines, 2));
  });
});
