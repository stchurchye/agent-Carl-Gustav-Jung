import { agentHookBus } from '../lib/agent/hooks.js';

/**
 * 确定性等待 long-poll handler 进入 hold(订阅 agent.event)。
 *
 * 背景:hold 测试曾用「睡 N ms 再 emit」武装事件,赌 handler 已完成
 * 进 hold 前的 3 次 DB 查询并订阅;全量串行跑时前序负载可使查询结果
 * 回调晚于 emit → 事件错过 → 走满 holdMs 的 idle 路径 → 偶发失败。
 *
 * 用法:必须在 app.fetch() 之前调用安装,await 返回后再 emit。
 * 'newListener' 在监听器加入前同步触发,但 resolve 的微任务要等 handler
 * 的同步段(订阅 + idle/heartbeat 计时器安装)全部完成后才运行,
 * 因此 await 返回时 hold 已完全武装。
 */
export function holdSubscription(): Promise<void> {
  return new Promise((resolve) => {
    const onNew = (name: string | symbol) => {
      if (name === 'agent.event') {
        agentHookBus.off('newListener', onNew);
        resolve();
      }
    };
    agentHookBus.on('newListener', onNew);
  });
}
