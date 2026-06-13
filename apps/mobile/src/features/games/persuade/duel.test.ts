import {
  applyTurn,
  DUEL_START_STUBBORNNESS,
  DUEL_TURNS,
  startDuel,
  type DuelVerdict,
} from './duel';

const v = (scoreDelta: number, mood: DuelVerdict['mood'] = 'wavering', reply = '哼'): DuelVerdict => ({
  reply,
  scoreDelta,
  mood,
});

describe('startDuel 开局', () => {
  it('争论中、固执满值、回合满、历史空、要求确定可复现', () => {
    const s = startDuel(42, 'sassy');
    expect(s.status).toBe('arguing');
    expect(s.stubbornness).toBe(DUEL_START_STUBBORNNESS);
    expect(s.turnsLeft).toBe(DUEL_TURNS);
    expect(s.history).toEqual([]);
    expect(s.demand.length).toBeGreaterThan(0);
    expect(startDuel(42, 'sassy').demand).toBe(s.demand);
  });
});

describe('applyTurn 一回合', () => {
  it('正分降低固执、记一来一回、回合 -1、更新心情', () => {
    const s = startDuel(42, 'sassy');
    const after = applyTurn(s, '给你买零食好不好', v(2, 'wavering', '真的吗?'));
    expect(after.stubbornness).toBe(DUEL_START_STUBBORNNESS - 2);
    expect(after.turnsLeft).toBe(DUEL_TURNS - 1);
    expect(after.history).toEqual([
      { role: 'player', text: '给你买零食好不好' },
      { role: 'dog', text: '真的吗?' },
    ]);
    expect(after.mood).toBe('wavering');
  });

  it('固执降到 0 → 赢', () => {
    let s = startDuel(42, 'sassy');
    s = applyTurn(s, 'a', v(3));
    s = applyTurn(s, 'b', v(3, 'won_over', '好吧!'));
    expect(s.stubbornness).toBeLessThanOrEqual(0);
    expect(s.status).toBe('won');
  });

  it('回合耗尽仍没说动 → 输', () => {
    let s = startDuel(42, 'sassy');
    for (let i = 0; i < DUEL_TURNS; i++) s = applyTurn(s, 'x', v(0, 'annoyed'));
    expect(s.turnsLeft).toBe(0);
    expect(s.status).toBe('lost');
  });

  it('结束后再 applyTurn 空操作', () => {
    let s = startDuel(42, 'sassy');
    s = applyTurn(s, 'a', v(3));
    s = applyTurn(s, 'b', v(3));
    const frozen = applyTurn(s, 'c', v(3));
    expect(frozen).toBe(s);
  });
});
