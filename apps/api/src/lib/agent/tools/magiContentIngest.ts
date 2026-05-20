import { createHash } from 'crypto';
import { toolRegistry, type ToolDef } from '../toolRegistry.js';
import { ingestMagiContent, magiContentEnabled } from '../../integrations/magi.js';

type MagiContentIngestInput = {
  url: string;
};

type MagiContentIngestOutput = {
  title: string;
  summary: string;
  videoUrl?: string;
  enabled: boolean;
};

/**
 * 把外部 URL 抽取后写入 MAGI Content 系统。
 *
 * - 写工具 → `approvalMode: 'ask'`，`costHint: 'medium'`，`hasSideEffects: true`。
 * - `idempotent: false`（外部副作用），但靠 `computeIdempotencyKey: sha256(url)`
 *   让 runtime 的 idempotency gate 同 run 内只调一次。
 * - 跨 run 的全局缓存留到 M1d；M1c 先满足 spec §18.3 验收 3。
 */
export const magiContentIngestTool: ToolDef<MagiContentIngestInput, MagiContentIngestOutput> = {
  name: 'magi_content_ingest',
  description:
    'Ingest a URL into the user\'s MAGI content vault (saves title + summary + video reference). Has side effects.',
  inputSchema: {
    type: 'object',
    required: ['url'],
    properties: {
      url: { type: 'string', description: '要归档的网页/视频 URL' },
    },
  },
  approvalMode: 'ask',
  costHint: 'medium',
  hasSideEffects: true,
  idempotent: false,
  computeIdempotencyKey: (input) =>
    'url-sha256:' + createHash('sha256').update((input as MagiContentIngestInput).url.trim()).digest('hex'),
  async handler(input) {
    const enabled = magiContentEnabled();
    const res = await ingestMagiContent(input.url);
    return {
      title: res.title,
      summary: res.summary,
      videoUrl: res.videoUrl,
      enabled,
    };
  },
};

export function registerMagiContentIngest(): void {
  if (!toolRegistry.get(magiContentIngestTool.name)) {
    toolRegistry.register(magiContentIngestTool);
  }
}
