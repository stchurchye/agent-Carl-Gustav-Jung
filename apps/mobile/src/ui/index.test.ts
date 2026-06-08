import * as ui from './index';

// 行为:ui/ 是大脑展示件的**稳定锚点桶**(纯 re-export 现有件,零行为改动)。
// IA 合并期下游可统一从 'ui' 取件,内部文件搬动不波及调用点。
it('re-exports the existing brain presentational components', () => {
  for (const name of [
    'BrainScreenShell',
    'BrainDataCard',
    'BrainJsonBlock',
    'BrainKeyRow',
    'BrainLogicBanner',
    'BrainMemoryFragmentList',
    'BrainMetricBar',
    'IntentChipBar',
  ]) {
    expect(typeof (ui as Record<string, unknown>)[name]).toBe('function');
  }
});
