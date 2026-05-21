import { toolRegistry, type ToolDef } from '../toolRegistry.js';
import { acquireSandbox } from '../sandbox.js';

type RunPythonInput = {
  code: string;
  description?: string;
};

type RunPythonOutput = {
  ok: boolean;
  stdout: string;
  stderr: string;
  result?: string;
  error?: string;
};

const MAX_CODE_BYTES = 16 * 1024;
const STDOUT_CAP = 8 * 1024;
const STDERR_CAP = 2 * 1024;
const RESULT_CAP = 4 * 1024;

function cap(s: string, max: number): string {
  if (s.length <= max) return s;
  const suffix = `\n...[truncated, ${s.length - max} more chars]`;
  return s.slice(0, max - suffix.length) + suffix;
}

export const runPythonTool: ToolDef<RunPythonInput, RunPythonOutput> = {
  name: 'run_python',
  description:
    'Run Python code in an isolated sandbox (E2B Firecracker microVM). Persistent across steps within the same agent run (variables retained). Supports full PyPI: pandas, numpy, matplotlib, statsmodels, etc. Use for calculations, regressions, charts, data exploration. 30s wall-clock limit, 1GB memory.',
  inputSchema: {
    type: 'object',
    required: ['code'],
    properties: {
      code: { type: 'string', maxLength: 16384 },
      description: { type: 'string' },
    },
  },
  approvalMode: 'auto',
  costHint: 'medium',
  hasSideEffects: true,
  idempotent: false,
  replyMeta: {
    summaryKind: 'text',
    failureHint:
      'Python 代码执行失败：沙箱可能超时(30s)、超内存(1GB)、或代码本身报错。先看 stderr 找 Python exception 原因，改 code 重试；持续失败考虑改用其他工具（如 search_papers 拿现成数据）。',
  },
  async handler(input, ctx) {
    if (Buffer.byteLength(input.code, 'utf-8') > MAX_CODE_BYTES) {
      return {
        ok: false,
        stdout: '',
        stderr: '',
        error: `code too large: ${Buffer.byteLength(input.code, 'utf-8')} bytes > ${MAX_CODE_BYTES}`,
      };
    }

    try {
      const sandbox = await acquireSandbox(ctx.runId);
      // E2B SDK: runCode() returns { logs, results, error }
      // The (sandbox as any) cast is needed because SandboxHandle type may not expose runCode
      const exec = await (sandbox as any).runCode(input.code);
      const stdout = (exec.logs?.stdout ?? []).join('');
      const stderrFromLogs = (exec.logs?.stderr ?? []).join('');
      const errorText = exec.error
        ? `${exec.error.name ?? 'Error'}: ${exec.error.value ?? ''}\n${exec.error.traceback ?? ''}`
        : '';
      const stderr = [stderrFromLogs, errorText].filter(Boolean).join('\n');
      const lastResult = exec.results?.[exec.results.length - 1];
      const resultText = lastResult
        ? typeof lastResult === 'string'
          ? lastResult
          : JSON.stringify(lastResult)
        : undefined;
      return {
        ok: true,
        stdout: cap(stdout, STDOUT_CAP),
        stderr: cap(stderr, STDERR_CAP),
        result: resultText ? cap(resultText, RESULT_CAP) : undefined,
      };
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') throw e;
      return {
        ok: false,
        stdout: '',
        stderr: '',
        error: e instanceof Error ? e.message : String(e),
      };
    }
  },
};

export function registerRunPython(): void {
  if (!toolRegistry.get(runPythonTool.name)) {
    toolRegistry.register(runPythonTool);
  }
}
