/**
 * 进程内活跃 run 的 AbortController 注册表。
 *
 * steer.ts / cancelRun / executeRun 三方共用同一个 Map，避免模块级私有 Map
 * 互相不可见的问题。runtime.ts 调 executeRun 时 set，finally 时 delete；
 * steer.ts / cancelRun get 后 abort()。
 */
export const runControllers = new Map<string, AbortController>();
