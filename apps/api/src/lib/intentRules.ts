import type { AppNavigateTarget, IntentCandidate, IntentKind } from '@xzz/shared';
import { matchOralIntentExamples } from '@xzz/shared';
import type { IntentChannel } from './intentAnalyzer.js';

const URL_RE = /https?:\/\/\S+/i;

/**
 * M1c：触发 agent_run 的自然语言信号。
 * - 调研/研究/整理一份报告/写文档存档
 * - 多关键词 → 把 agent_run 作为 primary 候选展示
 * - chip 默认 ask，不自动执行；autoExecute 仅斜杠命令路径走（详见 intentExecute）
 */
export const AGENT_RESEARCH_RE =
  /(?:研究|调研|深入了解|查清楚|帮我搞清楚|帮我搜集).{0,16}(?:资料|信息|内容|背景|案例|文档)?|帮我做一份.{0,20}报告|整理一份.{0,16}(?:报告|文档|资料|笔记)|写一份.{0,16}(?:报告|笔记|总结)|存到\s*magi|存档(?:到|进)\s*magi/i;

export const PERSONA_STYLE_RE =
  /对话风格|交流风格|说话风格|语气风格|聊天风格|性格设置|调整.{0,12}风格|改.{0,8}风格|想.{0,8}风格|我的风格|你怎么说话|说话方式|说话.{0,6}(?:别太冲|软一点|温柔|冲一点|生硬)|语气.{0,6}(?:软|冲|温柔|生硬)|(?:别太冲|温柔一点|软一点).{0,8}说话/;

/** 打开工作室「设置」页（与性格/密钥等子设置区分） */
export const STUDIO_SETTINGS_RE = /^(?:打开|去|进入)?设置(?:页面)?$/;

export type RuleMatchContext = {
  text: string;
  channel: IntentChannel;
  hasAttachments?: boolean;
};

type RuleMatch = {
  id: string;
  forceChips?: boolean;
  candidates: IntentCandidate[];
};

function nav(
  target: AppNavigateTarget,
  label: string,
  opts?: {
    description?: string;
    confidence?: number;
    group?: 'primary' | 'other';
  },
): IntentCandidate {
  return {
    kind: 'app_navigate',
    label,
    description: opts?.description,
    confidence: opts?.confidence ?? 0.88,
    group: opts?.group,
    slots: { navigateTarget: target },
  };
}

function chatKind(channel: IntentChannel): IntentKind {
  return channel === 'group' ? 'chat_group_llm' : 'chat_private_llm';
}

function chatLabel(channel: IntentChannel): string {
  return channel === 'group' ? '请 AI 回复' : '和 Bow wow 聊聊';
}

/** OpenClaw 式斜杠指令 */
export function matchSlashCommand(ctx: RuleMatchContext): RuleMatch | null {
  const raw = ctx.text.trim();
  if (!raw.startsWith('/')) return null;
  const cmd = raw.slice(1).split(/\s+/)[0]?.toLowerCase() ?? '';

  const table: Record<string, RuleMatch> = {
    性格: {
      id: 'slash_persona',
      forceChips: true,
      candidates: [nav('personality', '打开性格设置', { confidence: 0.95, group: 'primary' })],
    },
    人设: {
      id: 'slash_persona',
      forceChips: true,
      candidates: [nav('personality', '打开性格设置', { confidence: 0.95, group: 'primary' })],
    },
    记忆: {
      id: 'slash_memory',
      forceChips: true,
      candidates: [memoryNavigateCandidate(ctx, 0.95)],
    },
    日志: {
      id: 'slash_logs',
      forceChips: true,
      candidates: [
        nav('llm_logs', '狗狗通讯记录', { confidence: 0.92, group: 'primary' }),
        nav('client_logs', '客户端日志', { confidence: 0.85, group: 'other' }),
      ],
    },
    llm: {
      id: 'slash_llm',
      forceChips: true,
      candidates: [nav('llm_logs', '狗狗通讯记录', { confidence: 0.95 })],
    },
    导出: {
      id: 'slash_export',
      forceChips: true,
      candidates: [nav('export', '导出聊天记录', { confidence: 0.95 })],
    },
    压缩: {
      id: 'slash_compact',
      forceChips: true,
      candidates: [
        {
          kind: 'context_compact',
          label: '压缩上下文',
          description: '整理并压缩当前对话历史',
          confidence: 0.9,
        },
      ],
    },
    密钥: {
      id: 'slash_keys',
      forceChips: true,
      candidates: [nav('api_keys', '狗狗的联络方式', { confidence: 0.95 })],
    },
    设置: {
      id: 'slash_settings',
      forceChips: true,
      candidates: [nav('studio_settings', '打开设置', { confidence: 0.95, group: 'primary' })],
    },
    agent: {
      id: 'slash_agent',
      forceChips: true,
      candidates: [
        {
          kind: 'agent_run',
          label: '让 agent 跑',
          description: '后台多步执行，可中断',
          confidence: 0.95,
          group: 'primary',
        },
        {
          kind: chatKind(ctx.channel),
          label: chatLabel(ctx.channel),
          description: '不开 agent，直接和 AI 聊',
          confidence: 0.6,
          group: 'other',
        },
      ],
    },
  };

  return table[cmd] ?? null;
}

function memoryNavigateCandidate(ctx: RuleMatchContext, confidence: number): IntentCandidate {
  if (ctx.channel === 'group') {
    return nav('memory_topic', '查看话题记忆', {
      confidence,
      description: '打开当前话题下的短记忆列表',
      group: 'primary',
    });
  }
  return nav('memory_session', '查看会话记忆', {
    confidence,
    description: '打开本对话的短记忆列表',
    group: 'primary',
  });
}

function applyRule(
  id: string,
  test: boolean,
  build: () => IntentCandidate[],
  opts?: { forceChips?: boolean },
): RuleMatch | null {
  if (!test) return null;
  return { id, forceChips: opts?.forceChips, candidates: build() };
}

/**
 * persona_rename:「你以后就叫旺财」「给你起名叫骨头」→ 给狗改名;
 * 「(以后)叫我老王」「称呼我老王」→ 改用户称呼。
 * 疑问句(你叫什么)与空名不命中。只走规则不走 LLM 分类——改名是写操作,不容幻觉。
 */
export function matchPersonaRename(
  text: string,
): { target: 'assistant' | 'user'; name: string } | null {
  const t = text.trim();
  if (/[??]\s*$/.test(t) || /什么|啥/.test(t)) return null;
  const clean = (s: string) =>
    s.replace(/^[「"『'\s]+/, '').replace(/[」"』'\s。.!!~~]+$/, '').trim();
  // 「叫我X」比「你叫X」更具体,先匹配,避免「你以后叫我老王」被狗规则抢走
  const mu = t.match(/(?:以后|以後)?\s*(?:就)?\s*(?:请)?(?:叫|称呼)我\s*([^,。!?,.!?\s]{1,20})/);
  if (mu) {
    const name = clean(mu[1]);
    if (name) return { target: 'user', name };
  }
  const ma =
    t.match(/(?:给你|帮你|给它|给狗狗)?(?:起名|取名|改名)(?:叫|为)\s*([^,。!?,.!?\s]{1,20})/) ??
    t.match(/(?:你|妳)(?:的名字)?(?:以后|以後)?(?:就)?(?:改)?叫\s*([^,。!?,.!?\s]{1,20})/);
  if (ma) {
    const name = clean(ma[1]);
    if (name && !/^(谁|我)/.test(name)) return { target: 'assistant', name };
  }
  return null;
}

function collectRuleMatches(ctx: RuleMatchContext): RuleMatch[] {
  const text = ctx.text.trim();
  const t = text;
  const ch = ctx.channel;
  const matches: RuleMatch[] = [];

  const slash = matchSlashCommand(ctx);
  if (slash) matches.push(slash);

  const push = (m: RuleMatch | null) => {
    if (m) matches.push(m);
  };

  push(
    applyRule(
      'url',
      URL_RE.test(t) && !ctx.hasAttachments,
      () => [
        {
          kind: 'magi_content_link',
          label: '处理链接',
          description: '解析链接内容或生成摘要',
          confidence: 0.85,
          group: 'primary',
        },
      ],
      { forceChips: true },
    ),
  );

  push(
    applyRule(
      'memory_remember',
      /记住|记下|别忘了|要记得|保存到记忆|帮我记一下|记一下|记着呢|以后都按这个/.test(t),
      () => [
        {
          kind: 'memory_remember',
          label: '记住',
          description: '提炼并保存为记忆',
          confidence: 0.88,
          group: 'primary',
        },
      ],
      { forceChips: true },
    ),
  );

  push(
    applyRule(
      'memory_correct',
      /记错了|你记错|记忆错了|记忆.*不对|上次说的不对|之前记的不对|那条记忆.*错|写错了/.test(t),
      () => [
        {
          kind: 'memory_correct',
          label: '修正记忆',
          description: '选择一条记忆并更正',
          confidence: 0.9,
          group: 'primary',
        },
      ],
      { forceChips: true },
    ),
  );

  push(
    applyRule(
      'memory_forget',
      /别再说|不要再提|别提了|忘掉之前|不要再提之前|以后别提|别再提这事|别提这个了/.test(t),
      () => [
        {
          kind: 'memory_forget',
          label: '不再提起',
          description: '选择一条记忆并压制',
          confidence: 0.9,
          group: 'primary',
        },
      ],
      { forceChips: true },
    ),
  );

  const rename = matchPersonaRename(t);
  push(
    applyRule('persona_rename', rename !== null, () => [
      {
        kind: 'persona_rename',
        label: rename!.target === 'assistant' ? '给狗狗改名' : '改我的称呼',
        description:
          rename!.target === 'assistant'
            ? `以后它就叫「${rename!.name}」`
            : `以后它叫你「${rename!.name}」`,
        confidence: 0.95,
        group: 'primary',
        slots: { renameTarget: rename!.target, renameName: rename!.name },
      },
    ]),
  );

  push(
    applyRule(
      'context_compact',
      ch === 'private' && /压缩|compact|整理上下文/i.test(t),
      () => [
        {
          kind: 'context_compact',
          label: '压缩上下文',
          description: '合并较早对话为摘要',
          confidence: 0.75,
          group: 'primary',
        },
      ],
      { forceChips: true },
    ),
  );

  push(
    applyRule(
      'magi',
      /问.*知识库|\bmagi\b/i.test(t),
      () => [
        {
          kind: 'magi_system_query',
          label: '查询知识库',
          description: '在 MAGI 知识库中检索',
          confidence: 0.7,
          group: 'primary',
        },
      ],
      { forceChips: true },
    ),
  );

  push(
    applyRule(
      'agent_research',
      AGENT_RESEARCH_RE.test(t),
      () => [
        {
          kind: 'agent_run',
          label: '让 agent 跑',
          description: '搜资料 → 总结 → 写文档（可中断、可改主意）',
          confidence: 0.9,
          group: 'primary',
        },
        {
          kind: chatKind(ch),
          label: chatLabel(ch),
          description: '不开 agent，直接聊',
          confidence: 0.6,
          group: 'other',
        },
      ],
      { forceChips: true },
    ),
  );

  push(
    applyRule(
      'planning',
      /规划|计划一下|安排|待办|日程|下周|这周|路线图|怎么做比较好|帮我捋|捋一下|列个计划|想想怎么做|这周要做什么/.test(t),
      () => {
        const ck = chatKind(ch);
        return [
          {
            kind: ck,
            label: '只讨论、不写入待办',
            description: '在对话里一起捋思路，不自动落库',
            confidence: 0.88,
            group: 'primary',
          },
          {
            kind: ck,
            label: '整理成待办清单',
            description: '让助手输出可执行的条目供你确认',
            confidence: 0.82,
            group: 'primary',
          },
          {
            kind: 'memory_remember',
            label: '记住为偏好',
            description: '写入长期或会话记忆',
            confidence: 0.78,
            group: 'other',
          },
          {
            kind: ck,
            label: chatLabel(ch),
            description: '按普通聊天处理',
            confidence: 0.55,
            group: 'other',
          },
        ];
      },
      { forceChips: true },
    ),
  );

  push(
    applyRule(
      'persona_style',
      PERSONA_STYLE_RE.test(t),
      () => {
        const ck = chatKind(ch);
        return [
          nav('personality', '打开性格设置', {
            confidence: 0.9,
            description: '编辑助手形象、语气与关于我',
            group: 'primary',
          }),
          {
            kind: ck,
            label: chatLabel(ch),
            description: '在对话里说明你想怎么改',
            confidence: 0.6,
            group: 'other',
          },
        ];
      },
      { forceChips: true },
    ),
  );

  push(
    applyRule(
      'persona_identity',
      /助手名字|助手称呼|叫你什么|怎么称呼我|称呼我|改助手名/.test(t),
      () => [
        nav('personality_identity', '改助手形象', {
          confidence: 0.9,
          description: '称呼、风格关键词与表情',
          group: 'primary',
        }),
      ],
      { forceChips: true },
    ),
  );

  push(
    applyRule(
      'persona_soul',
      /(?:改|调整|设置).{0,8}(?:语气|边界|回复格式)|(?:语气|边界|回复格式).{0,8}(?:设置|改|调整)/.test(
        t,
      ) && !PERSONA_STYLE_RE.test(t),
      () => [
        nav('personality_soul', '改交流风格', {
          confidence: 0.88,
          description: '语气、边界与回复格式',
          group: 'primary',
        }),
      ],
      { forceChips: true },
    ),
  );

  push(
    applyRule(
      'persona_user',
      /关于我|我的简介|我的习惯|时区|希望被称呼/.test(t),
      () => [
        nav('personality_user', '编辑关于我', {
          confidence: 0.88,
          description: '简介、习惯与希望被称呼的方式',
          group: 'primary',
        }),
      ],
      { forceChips: true },
    ),
  );

  push(
    applyRule(
      'studio_settings',
      STUDIO_SETTINGS_RE.test(t),
      () => [nav('studio_settings', '打开设置', { confidence: 0.94, group: 'primary' })],
      { forceChips: true },
    ),
  );

  push(
    applyRule(
      'persona_open',
      /性格设置|打开性格|人设|性格页面/.test(t) && !PERSONA_STYLE_RE.test(t),
      () => [nav('personality', '打开性格设置', { confidence: 0.92, group: 'primary' })],
      { forceChips: true },
    ),
  );

  push(
    applyRule(
      'memory_nav_long',
      /长期记忆|全局记忆/.test(t),
      () => [nav('memory_long', '查看长期记忆', { confidence: 0.9, group: 'primary' })],
      { forceChips: true },
    ),
  );

  push(
    applyRule(
      'memory_nav_short',
      /短记忆/.test(t),
      () => [nav('memory_short', '查看短记忆', { confidence: 0.9, group: 'primary' })],
      { forceChips: true },
    ),
  );

  push(
    applyRule(
      'memory_nav_session',
      /会话记忆|这条对话的记忆/.test(t),
      () => [memoryNavigateCandidate(ctx, 0.9)],
      { forceChips: true },
    ),
  );

  push(
    applyRule(
      'memory_nav_topic',
      ch === 'group' && /话题记忆/.test(t),
      () => [
        nav('memory_topic', '查看话题记忆', {
          confidence: 0.9,
          group: 'primary',
        }),
      ],
      { forceChips: true },
    ),
  );

  push(
    applyRule(
      'api_keys',
      /API密钥|API 密钥|DeepSeek|ZenMux|百炼|密钥设置|模型密钥/.test(t),
      () => [nav('api_keys', '狗狗的联络方式', { confidence: 0.9, group: 'primary' })],
      { forceChips: true },
    ),
  );

  push(
    applyRule(
      'voice',
      /朗读|声音|音色|TTS|语音/.test(t),
      () => [nav('voice', '朗读声音设置', { confidence: 0.88, group: 'primary' })],
      { forceChips: true },
    ),
  );

  push(
    applyRule(
      'export',
      /导出|聊天记录导出|导出话题/.test(t),
      () => [nav('export', '导出聊天记录', { confidence: 0.88, group: 'primary' })],
      { forceChips: true },
    ),
  );

  push(
    applyRule(
      'documents',
      /打开文稿|我的文稿|文稿列表|写作列表|写稿|改稿|润色文稿|续写文稿|进入写作/.test(t),
      () => {
        const ck = chatKind(ch);
        return [
          nav('documents', '打开文稿列表', {
            confidence: 0.88,
            description: '查看与管理写作文稿',
            group: 'primary',
          }),
          {
            kind: ck,
            label: '在对话里说写作需求',
            description: '不切页面，先聊聊要写什么',
            confidence: 0.62,
            group: 'other',
          },
        ];
      },
      { forceChips: true },
    ),
  );

  push(
    applyRule(
      'profile',
      /个人资料|改头像|换头像|改昵称|修改昵称|我的头像/.test(t),
      () => [nav('profile', '个人资料', { confidence: 0.88, group: 'primary' })],
      { forceChips: true },
    ),
  );

  push(
    applyRule(
      'llm_logs',
      /LLM日志|LLM 日志|请求日志|模型调用|模型日志/.test(t),
      () => [nav('llm_logs', '狗狗通讯记录', { confidence: 0.9, group: 'primary' })],
      { forceChips: true },
    ),
  );

  push(
    applyRule(
      'client_logs',
      /客户端日志|本机日志/.test(t),
      () => [nav('client_logs', '客户端日志', { confidence: 0.9, group: 'primary' })],
      { forceChips: true },
    ),
  );

  return matches;
}

function dedupeCandidates(list: IntentCandidate[]): IntentCandidate[] {
  const seen = new Set<string>();
  const out: IntentCandidate[] = [];
  for (const c of list) {
    const key = `${c.kind}:${c.label}:${c.slots?.navigateTarget ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

export function buildCandidatesFromRules(ctx: RuleMatchContext): {
  candidates: IntentCandidate[];
  forceChips: boolean;
  matchedRuleIds: string[];
} {
  const matches = collectRuleMatches(ctx);
  const matchedRuleIds = matches.map((m) => m.id);
  let forceChips = matches.some((m) => m.forceChips);

  let candidates: IntentCandidate[] = [];
  for (const m of matches) {
    candidates.push(...m.candidates);
  }
  if (matches.length === 0) {
    const oral = candidatesFromOralExamples(ctx);
    if (oral.length > 0) {
      candidates.push(...oral);
      forceChips = true;
    }
  }

  const ck = chatKind(ctx.channel);
  candidates.push({
    kind: ck,
    label: chatLabel(ctx.channel),
    confidence: 0.6,
    group: 'other',
  });

  if (ctx.channel === 'group' && !ctx.hasAttachments) {
    candidates.push({
      kind: 'human_group_message',
      label: '只发群消息',
      description: '不调用 AI，仅发送到群里',
      confidence: 0.5,
      group: 'other',
    });
  }

  candidates = dedupeCandidates(candidates);
  candidates.sort((a, b) => b.confidence - a.confidence);

  return {
    candidates: candidates.slice(0, 6),
    forceChips,
    matchedRuleIds,
  };
}

export function needsSpecialIntentFromRules(ctx: RuleMatchContext): boolean {
  if (matchSlashCommand(ctx)) return true;
  if (matchOralIntentExamples(ctx.text).length > 0) return true;
  return collectRuleMatches(ctx).length > 0;
}

/** 口语示例未命中 regex 时，补一条与示例 id 对应的候选 */
export function candidatesFromOralExamples(ctx: RuleMatchContext): IntentCandidate[] {
  const ids = matchOralIntentExamples(ctx.text);
  const ch = ctx.channel;
  const ck = chatKind(ch);
  const out: IntentCandidate[] = [];

  for (const id of ids) {
    if (id === 'memory_remember') {
      out.push({
        kind: 'memory_remember',
        label: '记住',
        confidence: 0.8,
        group: 'primary',
      });
    } else if (id === 'memory_correct') {
      out.push({
        kind: 'memory_correct',
        label: '修正记忆',
        confidence: 0.82,
        group: 'primary',
      });
    } else if (id === 'memory_forget') {
      out.push({
        kind: 'memory_forget',
        label: '不再提起',
        confidence: 0.82,
        group: 'primary',
      });
    } else if (id === 'persona_style') {
      out.push(
        nav('personality', '打开性格设置', { confidence: 0.84, group: 'primary' }),
        {
          kind: ck,
          label: chatLabel(ch),
          confidence: 0.55,
          group: 'other',
        },
      );
    } else if (id === 'planning') {
      out.push(
        {
          kind: ck,
          label: '只讨论、不写入待办',
          confidence: 0.82,
          group: 'primary',
        },
        {
          kind: ck,
          label: '整理成待办清单',
          confidence: 0.76,
          group: 'primary',
        },
      );
    }
  }
  return out;
}
