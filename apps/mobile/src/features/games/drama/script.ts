import type { Script } from './story';

/**
 * 犬朝后宫 · 第一幕(完整竖切:对白 → 选择 → 说台词 → 查案 → 好/坏结局)。
 * 全部为原创人物、原创台词、原创情节,不涉及任何版权作品。D5 再扩写打磨。
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
      goto: 'probe',
      steps: [
        { kind: 'line', who: 'xuetuan', text: '一句话稳住了贵妃。可还没喘口气,前殿就出了乱子——' },
      ],
    },
    probe: {
      id: 'probe',
      bg: 'garden',
      cast: ['molan', 'xuetuan'],
      steps: [
        {
          kind: 'line',
          who: 'molan',
          text: '不好了!贵妃的茶点里被人下了泻药,如今矛头都指向你这新人。',
        },
        {
          kind: 'deduce',
          prompt: '当值的几只宫女狗里藏着真凶。嗅出蛛丝马迹,揪出下药的那一只,替雪团自证清白。',
          count: 6,
          budget: 2,
          seed: 7,
          onSolve: 'win',
          onFail: 'frame',
        },
      ],
    },
    win: {
      id: 'win',
      bg: 'hall',
      cast: ['xuetuan'],
      steps: [
        { kind: 'line', who: 'xuetuan', text: '真凶落网,清白得证。这后宫的第一关,雪团总算稳稳迈过。' },
        { kind: 'ending', outcome: 'good', text: '【第一幕·序】洗清冤屈,初露锋芒。雪团在犬朝后宫站住了脚跟。' },
      ],
    },
    frame: {
      id: 'frame',
      bg: 'garden',
      cast: ['jinyu', 'xuetuan'],
      steps: [
        { kind: 'line', who: 'jinyu', text: '查不出真凶?那这黑锅,就只好你这新人来背了。' },
        { kind: 'ending', outcome: 'bad', text: '【第一幕·冤】指错了人,雪团百口莫辩,被扣下了罪名。' },
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
