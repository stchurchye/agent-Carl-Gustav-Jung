import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./integrations/magi.js', () => ({ promoteAgentMemory: vi.fn() }));
vi.mock('../store/pg-intelligence.js', () => ({ createMemoryFragment: vi.fn() }));

import { promoteAgentMemory } from './integrations/magi.js';
import * as intel from '../store/pg-intelligence.js';
import { promoteMemoryToNative } from './memoryPromote.js';

const promote = vi.mocked(promoteAgentMemory);
const createFrag = vi.mocked(intel.createMemoryFragment);

describe('promoteMemoryToNative', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createFrag.mockResolvedValue({
      fragment: { id: 'frag-1' },
      version: {},
    } as never);
  });

  it('promotes: writes native user-scope fragment from the MAGI fact text', async () => {
    promote.mockResolvedValue({ promoted: true, text: '用户长期偏好简洁回答' });
    const r = await promoteMemoryToNative('userA', 7);
    expect(r).toEqual({ promoted: true, fragmentId: 'frag-1' });
    expect(promote).toHaveBeenCalledWith('userA', 7, undefined);
    expect(createFrag).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'userA',
        scope: 'user',
        content: '用户长期偏好简洁回答',
        source: 'import',
        status: 'active',
      }),
    );
  });

  it('idempotent: already promoted (promoted=false) → no native write', async () => {
    promote.mockResolvedValue({ promoted: false, text: null });
    const r = await promoteMemoryToNative('userA', 7);
    expect(r).toEqual({ promoted: false });
    expect(createFrag).not.toHaveBeenCalled();
  });

  it('owner is the trusted arg (run/JWT owner), never client-supplied text', async () => {
    // text 一律来自 MAGI(权威),不接受调用方传入 → 防注入任意原生记忆
    promote.mockResolvedValue({ promoted: true, text: 'MAGI 权威文本' });
    await promoteMemoryToNative('userB', 9);
    expect(createFrag).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'userB', content: 'MAGI 权威文本' }),
    );
  });
});
