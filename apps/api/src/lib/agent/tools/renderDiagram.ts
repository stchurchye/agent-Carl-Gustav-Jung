import { toolRegistry, type ToolDef } from '../toolRegistry.js';
import { getPool } from '../../../db/client.js';

type RenderDiagramInput = {
  mermaid: string;
  title: string;
};

type RenderDiagramOutput = {
  ok: boolean;
  diagramId: string;
  title: string;
  validationWarnings: string[];
  error?: string;
};

const MAX_BYTES = 8 * 1024;

const VALID_FIRST_TOKENS = new Set([
  'graph',
  'flowchart',
  'sequenceDiagram',
  'classDiagram',
  'stateDiagram',
  'stateDiagram-v2',
  'erDiagram',
  'gantt',
  'pie',
  'mindmap',
  'timeline',
  'journey',
  'gitGraph',
  'C4Context',
  'requirementDiagram',
  'quadrantChart',
]);

function validateMermaid(mermaid: string): string[] {
  const warnings: string[] = [];
  const firstToken = mermaid.trim().split(/\s+/)[0] ?? '';
  if (!VALID_FIRST_TOKENS.has(firstToken)) {
    warnings.push(
      `首行 token "${firstToken}" 不是已知 mermaid 图类型。常用：graph TD / flowchart LR / sequenceDiagram / classDiagram 等。`,
    );
  }
  return warnings;
}

export const renderDiagramTool: ToolDef<RenderDiagramInput, RenderDiagramOutput> = {
  name: 'render_diagram',
  description:
    'Render a Mermaid diagram (concept graph, flowchart, sequence, causal map, etc.) into the chat. Use for visualizing relationships between concepts, decision trees, or process flows. Input is Mermaid source — mobile renders it to SVG.',
  inputSchema: {
    type: 'object',
    required: ['mermaid', 'title'],
    properties: {
      mermaid: { type: 'string' },
      title: { type: 'string' },
    },
  },
  approvalMode: 'auto',
  costHint: 'low',
  hasSideEffects: true,
  idempotent: false,
  replyMeta: {
    summaryKind: 'silent',
    extractRef: (output: unknown) => {
      const o = output as RenderDiagramOutput;
      if (!o?.ok || !o.diagramId) return null;
      return { kind: 'diagram' as const, id: o.diagramId, label: o.title };
    },
    failureHint:
      'mermaid 渲染失败一般是语法错误。检查 validationWarnings；常见错：标签里有特殊字符（用 [] 引号包），或方向声明缺失（graph TD 开头）。',
  },
  async handler(input, ctx) {
    if (Buffer.byteLength(input.mermaid, 'utf-8') > MAX_BYTES) {
      return {
        ok: false,
        diagramId: '',
        title: input.title,
        validationWarnings: [],
        error: `mermaid source too large: ${Buffer.byteLength(input.mermaid, 'utf-8')} > ${MAX_BYTES}`,
      };
    }
    const warnings = validateMermaid(input.mermaid);
    try {
      const { rows } = await getPool().query(
        `INSERT INTO agent_diagrams (owner_id, run_id, step_id, title, mermaid, meta)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [
          ctx.ownerId,
          ctx.runId,
          ctx.stepId,
          input.title,
          input.mermaid,
          JSON.stringify({ runId: ctx.runId, stepId: ctx.stepId }),
        ],
      );
      const diagramId = rows[0]?.id as string;
      return { ok: true, diagramId, title: input.title, validationWarnings: warnings };
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') throw e;
      return {
        ok: false,
        diagramId: '',
        title: input.title,
        validationWarnings: warnings,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  },
};

export function registerRenderDiagram(): void {
  if (!toolRegistry.get(renderDiagramTool.name)) {
    toolRegistry.register(renderDiagramTool);
  }
}
