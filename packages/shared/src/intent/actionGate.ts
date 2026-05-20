import { oralExamplesSuggestAction } from './oralExamples.js';

/** 廉价门控：疑似操作/设置请求，避免对每条闲聊调用 classify */
export function isActionRequest(text: string): boolean {
  const t = text.trim();
  if (t.length < 2) return false;
  if (t.startsWith('/')) return true;
  if (oralExamplesSuggestAction(t)) return true;

  return (
    /(?:^|[，。！？\s])(?:请|帮我|能不能|可以|想要|需要)(?:你|把|我)?/.test(t) ||
    /^(?:打开|去|进入)?设置(?:页面)?$/.test(t) ||
    /(?:设置|打开|调整|改一下|改成|切换|查看|去|进入).{0,12}(?:页面|设置|记忆|性格|人设|日志|密钥|导出|压缩)/.test(
      t,
    ) ||
    /记住|记下|记错|别提|别再说|语气|风格|说话.{0,6}(?:冲|软|温柔)|规划|计划|待办|安排|日程/.test(
      t,
    )
  );
}
