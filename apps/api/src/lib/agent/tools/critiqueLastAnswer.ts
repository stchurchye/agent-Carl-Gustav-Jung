import { toolRegistry, type ToolDef } from '../toolRegistry.js';
import { resolveLlmClient } from '../runLlmClient.js';
import { getAgentRun, listSteps } from '../store.js';
import { extractJsonCandidate } from '../planner.js';

type CritiqueInput = {
  targetStepIdx?: number;
  focusAreas?: string[];
};

type CritiqueCriticism = {
  severity: 'high' | 'medium' | 'low';
  category: string;
  description: string;
};

type CritiqueOutput = {
  ok: boolean;
  criticisms: CritiqueCriticism[];
  overallAssessment: string;
  shouldRevise: boolean;
  error?: string;
};

const CRITIC_SYSTEM_PROMPT = `你是严谨的学术 critic。读取另一个 LLM 刚刚的输出 / 工具调用 / 推理，找出以下问题：
- unsupported_claim：声明了什么没有引用支持
- overconfident：用了"显然/必然/无疑"等过度自信表述
- logical_jump：A→B 之间缺中间论证
- factual_error：与已知事实矛盾
- other：其他严肃讨论中的硬伤

输出严格 JSON，结构：
{"criticisms":[{"severity":"high|medium|low","category":"...","description":"..."}],"overallAssessment":"1-2句总评","shouldRevise":true|false}
如无问题，criticisms 为空数组、shouldRevise: false。
不要 markdown 围栏，不要解释，只输出 JSON。`;

export const critiqueLastAnswerTool: ToolDef<CritiqueInput, CritiqueOutput> = {
  name: 'critique_last_answer',
  description:
    'Critique the most recent step output (or a specific step by index) using an LLM critic. Returns structured criticisms and whether a revision is warranted.',
  inputSchema: {
    type: 'object',
    properties: {
      targetStepIdx: {
        type: 'number',
        description: 'Optional step index to critique. Defaults to the most recent tool_call or observe step.',
      },
      focusAreas: {
        type: 'array',
        items: { type: 'string' },
        description: "Optional focus areas for the critic, e.g. ['未引用论断', '过度自信'].",
      },
    },
  },
  approvalMode: 'auto',
  costHint: 'medium',
  hasSideEffects: false,
  idempotent: true,
  replyMeta: {
    summaryKind: 'silent',
  },
  async handler(input, ctx) {
    try {
      const run = await getAgentRun(ctx.runId);
      if (!run) {
        return { ok: false, criticisms: [], overallAssessment: '', shouldRevise: false, error: 'run not found' };
      }

      const steps = await listSteps(ctx.runId);

      let targetStep;
      if (input.targetStepIdx !== undefined) {
        targetStep = steps.find((s) => s.idx === input.targetStepIdx);
      } else {
        // Take last step with kind 'tool_call' or 'observe'
        for (let i = steps.length - 1; i >= 0; i--) {
          if (steps[i].kind === 'tool_call' || steps[i].kind === 'observe') {
            targetStep = steps[i];
            break;
          }
        }
      }

      if (!targetStep) {
        return { ok: false, criticisms: [], overallAssessment: '', shouldRevise: false, error: 'no prior step to critique' };
      }

      const client = await resolveLlmClient(run);
      if (!client) {
        return { ok: false, criticisms: [], overallAssessment: '', shouldRevise: false, error: 'LLM client unavailable' };
      }

      const outputStr = JSON.stringify(targetStep.output ?? null);
      const capped = outputStr.length > 3000 ? outputStr.slice(0, 3000) + '…[truncated]' : outputStr;
      const focusNote =
        input.focusAreas && input.focusAreas.length > 0
          ? `\n\n请重点关注：${input.focusAreas.join('、')}`
          : '';

      const userPrompt = `以下是 step[${targetStep.idx}] (kind=${targetStep.kind}${targetStep.toolName ? ', tool=' + targetStep.toolName : ''}) 的输出，请 critique：\n\n${capped}${focusNote}`;

      const result = await client.chat(
        [
          { role: 'system', content: CRITIC_SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        { signal: ctx.signal },
      );

      const candidate = extractJsonCandidate(result.content);
      if (!candidate) {
        return { ok: false, criticisms: [], overallAssessment: '', shouldRevise: false, error: 'critic JSON parse failed' };
      }

      let parsed: { criticisms?: unknown; overallAssessment?: unknown; shouldRevise?: unknown };
      try {
        parsed = JSON.parse(candidate) as typeof parsed;
      } catch {
        return { ok: false, criticisms: [], overallAssessment: '', shouldRevise: false, error: 'critic JSON parse failed' };
      }

      const criticisms = Array.isArray(parsed.criticisms)
        ? (parsed.criticisms as CritiqueCriticism[])
        : [];
      const overallAssessment = typeof parsed.overallAssessment === 'string' ? parsed.overallAssessment : '';
      const shouldRevise = typeof parsed.shouldRevise === 'boolean' ? parsed.shouldRevise : false;

      return { ok: true, criticisms, overallAssessment, shouldRevise };
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') throw e;
      return {
        ok: false,
        criticisms: [],
        overallAssessment: '',
        shouldRevise: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  },
};

export function registerCritiqueLastAnswer(): void {
  if (!toolRegistry.get(critiqueLastAnswerTool.name)) {
    toolRegistry.register(critiqueLastAnswerTool);
  }
}
