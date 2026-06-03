/**
 * 密钥脱敏：把对象/字符串里的密钥换成 [REDACTED:<label>]，返回新值、不改原对象。
 * 借鉴 agentmemory 的隐私脱敏思路。纯函数、同步、无 LLM。
 *
 * 用途：step.input 落库前脱敏（用户可能把 API key 误粘进工具入参）。
 * 取舍：research agent 的工具入参里常有"token/secret/password"等普通词，故 generic
 * 模式只认 key-like 复合词 + 至少 12 位 key 字符的值，避免把正常查询误打码。
 */

type SecretPattern = { label: string; re: RegExp };

// 多数格式加左边界 (?<![\w-])，避免命中标识符/slug 中间的 sk- 之类。
const SECRET_PATTERNS: SecretPattern[] = [
  { label: 'anthropic', re: /(?<![\w-])sk-ant-[A-Za-z0-9\-_]{20,}/g },
  // openai 现代前缀 key（sk-proj-/sk-svcacct-/sk-admin-）：body 允许 -_，整把刮掉
  { label: 'openai', re: /(?<![\w-])sk-(?:proj|svcacct|admin)-[A-Za-z0-9_-]{20,}/g },
  // openai 经典 key：body 只认纯字母数字，避免误伤 sk-foo-bar-... 这种 slug
  { label: 'openai', re: /(?<![\w-])sk-[A-Za-z0-9]{20,}/g },
  { label: 'groq', re: /(?<![\w-])gsk_[A-Za-z0-9]{30,}/g },
  { label: 'xai', re: /(?<![\w-])xai-[A-Za-z0-9]{20,}/g },
  { label: 'github', re: /(?<![\w-])gh[pousr]_[A-Za-z0-9]{30,}/g },
  { label: 'aws', re: /(?<![\w-])AKIA[0-9A-Z]{16}/g },
  { label: 'slack', re: /(?<![\w-])xox[baprs]-[A-Za-z0-9-]{10,}/g },
  { label: 'stripe', re: /(?<![\w-])[rs]k_(?:live|test)_[A-Za-z0-9]{16,}/g },
  { label: 'google-key', re: /(?<![\w-])AIza[0-9A-Za-z\-_]{35}/g },
  { label: 'google-oauth', re: /(?<![\w-])ya29\.[A-Za-z0-9\-_]{20,}/g },
  { label: 'jwt', re: /(?<![\w-])eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
  // DB/broker 连接串里的密码：scheme://user:PASS@host
  {
    label: 'connstring',
    re: /(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqps?):\/\/[^:\s/@]+:[^@\s]+@/gi,
  },
  { label: 'bearer', re: /[Bb]earer\s+[A-Za-z0-9\-._~+/]{16,}=*/g },
  // 通用 key=value / key: value —— 只认 key-like 复合词 + ≥12 位 key 字符的值，
  // 不认裸 token/secret/password（research 查询里太常见，会误伤）。
  {
    label: 'generic',
    re: /\b(?:api[_-]?key|apikey|secret[_-]?key|private[_-]?key|client[_-]?secret|access[_-]?token|auth[_-]?token)\b["']?\s*[:=]\s*["']?[A-Za-z0-9\-._~+/]{12,}/gi,
  },
];

function redactString(s: string): string {
  let out = s;
  for (const { label, re } of SECRET_PATTERNS) {
    out = out.replace(re, `[REDACTED:${label}]`);
  }
  return out;
}

function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function redactSecrets(value: unknown): unknown {
  if (typeof value === 'string') return redactString(value);
  if (Array.isArray(value)) return value.map((v) => redactSecrets(v));
  if (value && typeof value === 'object') {
    // 只深walk 纯对象；Date/Buffer/Map 等原样返回，避免被改写成残缺的普通对象。
    if (!isPlainObject(value)) return value;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = redactSecrets(v);
    }
    return out;
  }
  return value;
}
