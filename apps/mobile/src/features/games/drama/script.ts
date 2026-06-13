import type { Script } from './story';

/**
 * 犬朝后宫 · 第一幕(D1 骨架 + D2 说台词戏点;原创内容,不涉及任何版权作品)。
 * D3 接查案、D5 扩写成完整一幕。
 */
export const ACT1: Script = {
  start: 'gate',
  scenes: {
    gate: {
      id: 'gate',
      bg: 'gate',
      cast: ['laofu', 'xuetuan'],
      steps: [
        { kind: 'line', who: 'laofu', text: '新来的答应？规矩还没学全,就敢往前凑。' },
        { kind: 'line', who: 'xuetuan', text: '(深吸一口气)雪团初入宫闱,还请嬷嬷指点。' },
        {
          kind: 'choice',
          prompt: '老福嬷嬷拦在宫门前,该如何应对?',
          options: [
            { label: '屈膝行礼,先递上见面礼', setFlags: ['polite'], goto: 'meet' },
            { label: '抬头直言,我是奉旨入宫', goto: 'meet' },
          ],
        },
      ],
    },
    meet: {
      id: 'meet',
      bg: 'hall',
      cast: ['jinyu', 'xuetuan'],
      steps: [
        {
          kind: 'line',
          who: 'jinyu',
          text: '哟,这就是新来的雪团？瞧这怯生生的样子,也敢来争宠?当众说句话听听。',
        },
        {
          kind: 'sayline',
          who: 'jinyu',
          context: '前殿初见,金羽贵妃当众刁难新入宫的雪团,众人围观。',
          intent: '不卑不亢地化解贵妃的当众刁难——既不示弱讨饶,也不顶撞冒犯,把场面稳住、留有余地。',
          onPass: 'hall',
          onFail: 'snub',
        },
      ],
    },
    hall: {
      id: 'hall',
      bg: 'hall',
      cast: ['xuetuan'],
      steps: [
        { kind: 'line', who: 'xuetuan', text: '一句话稳住了贵妃。这后宫的水深,但雪团总算站住了第一步。' },
        { kind: 'ending', outcome: 'good', text: '【第一幕·序】雪团不卑不亢,在前殿初露锋芒。' },
      ],
    },
    snub: {
      id: 'snub',
      bg: 'hall',
      cast: ['jinyu', 'xuetuan'],
      steps: [
        { kind: 'line', who: 'jinyu', text: '就这点本事,也配进这后宫?来人,送答应回去好好学规矩。' },
        { kind: 'ending', outcome: 'bad', text: '【第一幕·挫】雪团一句话没说好,当众失了颜面。' },
      ],
    },
  },
};
