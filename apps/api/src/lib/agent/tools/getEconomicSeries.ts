import { toolRegistry, type ToolDef } from '../toolRegistry.js';

type GetEconomicSeriesInput = {
  seriesId: string;
  startDate?: string;
  endDate?: string;
};

type Observation = { date: string; value: number | null };

type GetEconomicSeriesOutput = {
  ok: boolean;
  seriesId: string;
  title: string;
  units: string;
  frequency: string;
  observations: Observation[];
  truncated: boolean;
  error?: string;
};

const MAX_OBS = 200;

export const getEconomicSeriesTool: ToolDef<GetEconomicSeriesInput, GetEconomicSeriesOutput> = {
  name: 'get_economic_series',
  description:
    'Fetch a macroeconomic time series from FRED (Federal Reserve Economic Data). Use for GDP, CPI, unemployment, interest rates, etc. Common series IDs: UNRATE (unemployment), CPIAUCSL (CPI), GDP (gross domestic product), FEDFUNDS (fed funds rate). Returns up to 200 observations.',
  inputSchema: {
    type: 'object',
    required: ['seriesId'],
    properties: {
      seriesId: { type: 'string' },
      startDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
      endDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
    },
  },
  approvalMode: 'auto',
  costHint: 'low',
  hasSideEffects: false,
  idempotent: true,
  replyMeta: {
    summaryKind: 'text',
    failureHint:
      'FRED 失败常见：seriesId 不存在（如把"CPI"当 id，正确是"CPIAUCSL"）/ API key 缺失 / quota。可先 search_web 查 series ID 再调；persistent 失败让用户手动确认。',
  },
  computeIdempotencyKey: (input) => {
    const i = input as GetEconomicSeriesInput;
    return `fred:${i.seriesId}:${i.startDate ?? '2000-01-01'}:${i.endDate ?? 'today'}`;
  },
  async handler(input, ctx) {
    const apiKey = process.env.FRED_API_KEY?.trim();
    if (!apiKey) {
      return {
        ok: false, seriesId: input.seriesId, title: '', units: '', frequency: '',
        observations: [], truncated: false,
        error: 'FRED_API_KEY is not configured (server env or user override)',
      };
    }
    const startDate = input.startDate ?? '2000-01-01';
    const endDate = input.endDate ?? new Date().toISOString().slice(0, 10);
    try {
      const obsUrl =
        `https://api.stlouisfed.org/fred/series/observations?series_id=${encodeURIComponent(input.seriesId)}` +
        `&observation_start=${startDate}&observation_end=${endDate}&api_key=${apiKey}&file_type=json`;
      const metaUrl =
        `https://api.stlouisfed.org/fred/series?series_id=${encodeURIComponent(input.seriesId)}` +
        `&api_key=${apiKey}&file_type=json`;

      const [obsRes, metaRes] = await Promise.all([
        fetch(obsUrl, { signal: ctx.signal }),
        fetch(metaUrl, { signal: ctx.signal }),
      ]);

      if (!obsRes.ok) {
        return {
          ok: false, seriesId: input.seriesId, title: '', units: '', frequency: '',
          observations: [], truncated: false,
          error: `FRED observations HTTP ${obsRes.status}`,
        };
      }
      if (!metaRes.ok) {
        return {
          ok: false, seriesId: input.seriesId, title: '', units: '', frequency: '',
          observations: [], truncated: false,
          error: `FRED series-meta HTTP ${metaRes.status}`,
        };
      }
      const obsJson = (await obsRes.json()) as { observations?: Array<{ date: string; value: string }> };
      const metaJson = (await metaRes.json()) as { seriess?: Array<{ title?: string; units?: string; frequency?: string }> };
      const meta = metaJson.seriess?.[0] ?? {};
      const all = obsJson.observations ?? [];
      const truncated = all.length > MAX_OBS;
      const observations = (truncated ? all.slice(-MAX_OBS) : all).map((o) => ({
        date: o.date,
        value: o.value === '.' ? null : Number(o.value),
      }));
      return {
        ok: true,
        seriesId: input.seriesId,
        title: String(meta.title ?? input.seriesId),
        units: String(meta.units ?? ''),
        frequency: String(meta.frequency ?? ''),
        observations,
        truncated,
      };
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') throw e;
      return {
        ok: false, seriesId: input.seriesId, title: '', units: '', frequency: '',
        observations: [], truncated: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  },
};

export function registerGetEconomicSeries(): void {
  if (!toolRegistry.get(getEconomicSeriesTool.name)) {
    toolRegistry.register(getEconomicSeriesTool);
  }
}
