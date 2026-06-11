import { brainLogicHints } from './logicHints';
import { apiKeyBrainHint } from './apiKeyBrainHint';

const ALL_HINT_TEXTS: Array<{ path: string; text: string }> = [
  ...Object.entries(brainLogicHints).flatMap(([key, hint]) => [
    { path: `logicHints.${key}.howRemember`, text: hint.howRemember },
    { path: `logicHints.${key}.howUse`, text: hint.howUse },
  ]),
  ...(['deepseek', 'zenmux', 'dashscope'] as const).flatMap((kind) => {
    const hint = apiKeyBrainHint(kind);
    return [
      { path: `apiKeyBrainHint.${kind}.howRemember`, text: hint.howRemember },
      { path: `apiKeyBrainHint.${kind}.howUse`, text: hint.howUse },
    ];
  }),
];

describe('brain 提示文案守门', () => {
  it('不再出现「小助手」「流浪猫」', () => {
    const offenders = ALL_HINT_TEXTS.filter(
      (e) => e.text.includes('小助手') || e.text.includes('流浪猫'),
    ).map((e) => e.path);
    expect(offenders).toEqual([]);
  });

  it('陈旧的「家用钥匙」改为「狗狗的联络方式」', () => {
    expect(brainLogicHints.agentDefaultModel.howUse).not.toContain('家用钥匙');
    expect(brainLogicHints.agentDefaultModel.howUse).toContain('狗狗的联络方式');
  });
});
