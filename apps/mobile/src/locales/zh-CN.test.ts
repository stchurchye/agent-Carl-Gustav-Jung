import { zh } from './zh-CN';

type Entry = { path: string; text: string };

function collectStrings(node: unknown, path: string, out: Entry[]): void {
  if (typeof node === 'string') {
    out.push({ path, text: node });
    return;
  }
  if (typeof node === 'function') {
    // 函数型 key 用样例参数求值;模板串对参数类型不敏感,够守门用
    const fn = node as (...args: unknown[]) => unknown;
    out.push({ path, text: String(fn('样例', 2, 3)) });
    return;
  }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) collectStrings(v, `${path}.${k}`, out);
  }
}

describe('locale 守门:旧品牌词清零', () => {
  it('全部文案(含函数 key 求值结果)不再出现「小助手」「流浪猫」', () => {
    const out: Entry[] = [];
    collectStrings(zh, 'zh', out);
    const offenders = out
      .filter((e) => e.text.includes('小助手') || e.text.includes('流浪猫'))
      .map((e) => e.path);
    expect(offenders).toEqual([]);
  });
});

describe('Bow Wow 关键新文案', () => {
  it('Tab 与枢纽标题', () => {
    expect(zh.tabs.brain).toBe('My Bow Wow');
    expect(zh.brain.hubTitle).toBe('My Bow Wow');
    // 群分区品牌词:Title Case「Bow Wow Group」(防 typo/漏改回归)
    expect(zh.tabs.groups).toBe('Bow Wow Group');
    expect(zh.tabs.studio).toBe('Bow Wow Group');
  });

  it('欢迎语带狗名且保留斜杠命令提示', () => {
    const hint = zh.chat.emptyHint('旺财');
    expect(hint).toContain('旺财');
    expect(hint).toContain('/性格');
  });

  it('思考中提示带狗名', () => {
    expect(zh.chat.thinking('旺财')).toContain('旺财');
    expect(zh.chat.thinkingLong('旺财')).toContain('旺财');
  });

  it('BrainHub 硬编码迁入的新 key', () => {
    expect(zh.brain.sections.agentTasks).toBe('跑腿任务');
    expect(zh.brain.sections.agentDefaultModel).toBe('跑腿用的默认模型');
    expect(zh.brain.agentTasksHint.length).toBeGreaterThan(0);
    expect(zh.brain.agentDefaultModelHint.length).toBeGreaterThan(0);
  });
});
