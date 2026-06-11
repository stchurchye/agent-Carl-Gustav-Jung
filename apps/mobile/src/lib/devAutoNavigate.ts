import type { NavigationContainerRefWithCurrent } from '@react-navigation/native';

/**
 * __DEV__ 专用:启动后从本机 :3979/nav.json 读一条导航指令并跳转,
 * 给无人值守的活体验证用(模拟器截屏巡屏不依赖点击注入)。
 * 文件不存在/服务未起 → 静默跳过,对正常开发零影响;生产构建被 __DEV__ 剪除。
 *
 * nav.json 形如:{ "tab": "BrainTab", "screen": "BrainEpisodicMemory", "params": {} }
 */
export function devAutoNavigate(
  navRef: NavigationContainerRefWithCurrent<Record<string, unknown>>,
): void {
  if (!__DEV__) return;
  void (async () => {
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 800);
      // cache-bust:无 Cache-Control 的 GET 会被 NSURLCache 启发式缓存,导致拿旧指令
      const res = await fetch(`http://127.0.0.1:3979/nav.json?t=${Date.now()}`, {
        signal: ctl.signal,
        headers: { 'Cache-Control': 'no-cache' },
      });
      clearTimeout(timer);
      if (!res.ok) return;
      const cmd = (await res.json()) as {
        tab?: string;
        screen?: string;
        params?: Record<string, unknown>;
      };
      if (!cmd?.tab) return;
      // 等导航树就绪后再跳(onReady 已保证,但保险重试一次)
      const go = () => {
        if (!navRef.isReady()) return setTimeout(go, 300);
        // 跨 tab 嵌套导航;类型在运行时由 navigator 校验,这里走宽松通道
        (navRef.navigate as (name: string, params?: unknown) => void)(
          cmd.tab!,
          cmd.screen ? { screen: cmd.screen, params: cmd.params } : undefined,
        );
      };
      go();
    } catch {
      // 服务未起:正常路径,静默
    }
  })();
}
