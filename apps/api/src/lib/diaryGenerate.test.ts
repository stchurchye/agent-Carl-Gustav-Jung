import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./zenmux.js', () => ({ zenmuxChatFromMessages: vi.fn() }));

import { zenmuxChatFromMessages } from './zenmux.js';
import { generateDiarySummary } from './diaryGenerate.js';

const mockLlm = zenmuxChatFromMessages as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockLlm.mockReset();
  mockLlm.mockResolvedValue({ content: '  汪!今天主人很累,我一直陪着他。  ', usage: {} });
});

describe('generateDiarySummary', () => {
  it('system 注入 persona 狗名 + 日记规则;user 含 transcript;返回 LLM 正文(trim)', async () => {
    const out = await generateDiarySummary({
      apiKey: 'k',
      persona: { identity: { assistantName: '旺财' } },
      scope: 'self',
      transcript: '我：今天好累\n\n旺财：抱抱',
    });
    expect(out).toBe('汪!今天主人很累,我一直陪着他。');
    const call = mockLlm.mock.calls[0];
    const msgs = call[2] as Array<{ role: string; content: string }>;
    expect(msgs[0].role).toBe('system');
    expect(msgs[0].content).toContain('旺财'); // persona 注入
    expect(msgs[0].content).toContain('日记'); // 日记规则
    expect(msgs[1].content).toContain('今天好累'); // transcript
    expect(msgs[1].content).not.toContain('已有日记'); // fresh 路径不应出现更新措辞
    expect(msgs[1].content).not.toContain('更新这篇日记');
  });

  it('self 篇 existingSummary 也走「更新」分支(日常增量,不依赖 scope)', async () => {
    await generateDiarySummary({
      apiKey: 'k',
      persona: undefined,
      scope: 'self',
      transcript: '我：又聊了会儿',
      existingSummary: '上午写的',
    });
    const msgs = mockLlm.mock.calls[0][2] as Array<{ role: string; content: string }>;
    expect(msgs[1].content).toContain('已有日记');
    expect(msgs[1].content).toContain('更新这篇日记');
    expect(msgs[1].content).not.toContain('群名'); // self 篇不带群名
  });

  it('空 transcript 不调用 LLM,返回已有摘要', async () => {
    const out = await generateDiarySummary({
      apiKey: 'k',
      persona: undefined,
      scope: 'self',
      transcript: '   ',
      existingSummary: '旧日记',
    });
    expect(out).toBe('旧日记');
    expect(mockLlm).not.toHaveBeenCalled();
  });

  it('群篇 user 带群名;有 existingSummary 走「更新」分支', async () => {
    await generateDiarySummary({
      apiKey: 'k',
      persona: undefined,
      scope: 'group',
      scopeName: '读书会',
      transcript: '张三：今天聊了《活着》',
      existingSummary: '上午的记录',
    });
    const msgs = mockLlm.mock.calls[0][2] as Array<{ role: string; content: string }>;
    expect(msgs[1].content).toContain('读书会');
    expect(msgs[1].content).toContain('已有日记');
    expect(msgs[1].content).toContain('更新');
  });
});
