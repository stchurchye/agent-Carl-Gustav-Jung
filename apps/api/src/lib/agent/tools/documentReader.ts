import { toolRegistry, type ToolDef } from '../toolRegistry.js';
import pdfParse from 'pdf-parse';
import * as XLSX from 'xlsx';

// mammoth's ESM export varies by environment; use dynamic import to handle both
type MammothModule = { convertToMarkdown: (opts: { buffer: Buffer }) => Promise<{ value: string }> };

async function loadMammoth(): Promise<MammothModule> {
  const m = await import('mammoth');
  // mammoth exports convertToMarkdown at runtime but its bundled type definition omits it
  return ((m.default ?? m) as unknown) as MammothModule;
}

type DocumentReaderInput = {
  url: string;
};

type DocumentReaderOutput = {
  ok: boolean;
  url: string;
  format: 'pdf' | 'docx' | 'xlsx' | 'unknown';
  text: string;
  truncated: boolean;
  error?: string;
};

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_TEXT_CHARS = 32 * 1024;

const PDF_CT = /pdf/i;
const DOCX_CT = /wordprocessingml|msword/i;
const XLSX_CT = /spreadsheetml|excel/i;

function inferFormat(contentType: string, url: string): DocumentReaderOutput['format'] {
  if (PDF_CT.test(contentType) || /\.pdf($|\?)/i.test(url)) return 'pdf';
  if (DOCX_CT.test(contentType) || /\.docx($|\?)/i.test(url)) return 'docx';
  if (XLSX_CT.test(contentType) || /\.xlsx($|\?)/i.test(url)) return 'xlsx';
  return 'unknown';
}

async function xlsxToMarkdown(buf: Buffer): Promise<string> {
  const wb = XLSX.read(buf, { type: 'buffer' });
  const parts: string[] = [];
  for (const sheetName of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[sheetName]);
    if (rows.length === 0) continue;
    const headers = Object.keys(rows[0]);
    parts.push(`## ${sheetName}\n`);
    parts.push('| ' + headers.join(' | ') + ' |');
    parts.push('|' + headers.map(() => '---').join('|') + '|');
    for (const row of rows.slice(0, 200)) {
      parts.push('| ' + headers.map((h) => String(row[h] ?? '')).join(' | ') + ' |');
    }
    parts.push('');
  }
  return parts.join('\n');
}

export const documentReaderTool: ToolDef<DocumentReaderInput, DocumentReaderOutput> = {
  name: 'document_reader',
  description:
    'Fetch a document URL and extract its text. Supports PDF (pdf-parse), Word .docx (mammoth → markdown), Excel .xlsx (xlsx → markdown tables). Use when the user pastes a document link or after search_papers returns a PDF DOI. 8MB upload cap, 32K char output cap.',
  inputSchema: {
    type: 'object',
    required: ['url'],
    properties: { url: { type: 'string' } },
  },
  approvalMode: 'auto',
  costHint: 'medium',
  hasSideEffects: false,
  idempotent: true,
  replyMeta: {
    summaryKind: 'text',
    // S1(K 战役):深读过的外部文档与 fetch_url 同为外部 provenance,产 url ref 进资源
    // 清单与 checkpoint。pdf-parse 无可靠标题,label 用 URL(fetchUrl 同款先例)。
    extractRef: (output: unknown) => {
      const o = output as DocumentReaderOutput;
      if (!o?.ok || !o.url) return null;
      return { kind: 'url' as const, id: o.url, label: o.url };
    },
    failureHint:
      '文档读取失败：URL 可能不可达、非 PDF/DOCX/XLSX 格式、或文件过大（>8MB）。可尝试用 search_web 找该文档的网页版替代，或让用户提供文本摘录。',
  },
  computeIdempotencyKey: (input) => `doc:${(input as DocumentReaderInput).url.trim()}`,
  async handler(input, ctx) {
    try {
      const res = await fetch(input.url, { signal: ctx.signal });
      if (!res.ok) {
        return {
          ok: false, url: input.url, format: 'unknown', text: '', truncated: false,
          error: `HTTP ${res.status} for ${input.url}`,
        };
      }
      const contentLength = Number(res.headers.get('content-length') ?? 0);
      if (contentLength > MAX_BYTES) {
        return {
          ok: false, url: input.url, format: 'unknown', text: '', truncated: false,
          error: `document too large: ${contentLength} > ${MAX_BYTES} bytes`,
        };
      }
      const arrayBuffer = await res.arrayBuffer();
      if (arrayBuffer.byteLength > MAX_BYTES) {
        return {
          ok: false, url: input.url, format: 'unknown', text: '', truncated: false,
          error: `document too large after download: ${arrayBuffer.byteLength} > ${MAX_BYTES}`,
        };
      }
      const buf = Buffer.from(arrayBuffer);
      const format = inferFormat(res.headers.get('content-type') ?? '', input.url);

      let text = '';
      if (format === 'pdf') {
        const parsed = await pdfParse(buf);
        text = parsed.text ?? '';
      } else if (format === 'docx') {
        const mammoth = await loadMammoth();
        const result = await mammoth.convertToMarkdown({ buffer: buf });
        text = result.value ?? '';
      } else if (format === 'xlsx') {
        text = await xlsxToMarkdown(buf);
      } else {
        return {
          ok: false, url: input.url, format: 'unknown', text: '', truncated: false,
          error: `unsupported format (content-type=${res.headers.get('content-type')}, url=${input.url})`,
        };
      }

      const truncated = text.length > MAX_TEXT_CHARS;
      return {
        ok: true,
        url: input.url,
        format,
        text: truncated ? text.slice(0, MAX_TEXT_CHARS) : text,
        truncated,
      };
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') throw e;
      return {
        ok: false, url: input.url, format: 'unknown', text: '', truncated: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  },
};

export function registerDocumentReader(): void {
  if (!toolRegistry.get(documentReaderTool.name)) {
    toolRegistry.register(documentReaderTool);
  }
}
