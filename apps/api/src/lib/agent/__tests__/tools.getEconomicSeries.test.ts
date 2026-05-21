import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getEconomicSeriesTool, registerGetEconomicSeries } from '../tools/getEconomicSeries.js';
import { toolRegistry } from '../toolRegistry.js';

const fakeCtx = {
  runId: 'r', stepId: 's', ownerId: 'u', channel: 'private' as const,
  signal: new AbortController().signal,
};

describe('get_economic_series (FRED) tool', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    process.env.FRED_API_KEY = 'test-fred-key';
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.FRED_API_KEY;
  });

  it('registers idempotently', () => {
    registerGetEconomicSeries();
    registerGetEconomicSeries();
    expect(toolRegistry.get('get_economic_series')).toBeDefined();
  });

  it('happy path: returns observations + metadata', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(url);
      if (url.includes('/series/observations')) {
        return new Response(JSON.stringify({
          observations: [
            { date: '2020-01-01', value: '3.5' },
            { date: '2020-02-01', value: '3.5' },
            { date: '2020-03-01', value: '4.4' },
          ],
        }), { status: 200 });
      }
      if (url.includes('/series?')) {
        return new Response(JSON.stringify({
          seriess: [{ title: 'Unemployment Rate', units: 'Percent', frequency: 'Monthly' }],
        }), { status: 200 });
      }
      throw new Error('unexpected url ' + url);
    }));

    const out = await getEconomicSeriesTool.handler({ seriesId: 'UNRATE' }, fakeCtx);
    expect(out.ok).toBe(true);
    expect(out.seriesId).toBe('UNRATE');
    expect(out.title).toContain('Unemployment');
    expect(out.observations).toHaveLength(3);
    expect(out.observations[0].value).toBe(3.5);
  });

  it('no FRED_API_KEY → ok:false with config error', async () => {
    delete process.env.FRED_API_KEY;
    const out = await getEconomicSeriesTool.handler({ seriesId: 'X' }, fakeCtx);
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/FRED_API_KEY/);
  });

  it('FRED 400 (unknown series) → ok:false', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('bad', { status: 400 })));
    const out = await getEconomicSeriesTool.handler({ seriesId: 'NOPE' }, fakeCtx);
    expect(out.ok).toBe(false);
  });

  it('over 200 observations → truncated:true', async () => {
    const obs = Array.from({ length: 250 }, (_, i) => ({ date: `2020-01-${(i % 28) + 1}`, value: String(i) }));
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('observations')) {
        return new Response(JSON.stringify({ observations: obs }), { status: 200 });
      }
      return new Response(JSON.stringify({ seriess: [{ title: 't', units: 'u', frequency: 'M' }] }), { status: 200 });
    }));
    const out = await getEconomicSeriesTool.handler({ seriesId: 'X' }, fakeCtx);
    expect(out.observations).toHaveLength(200);
    expect(out.truncated).toBe(true);
  });
});
