import type { Script } from './story';

/**
 * 犬朝后宫 · 第一幕《初入宫闱》。
 * 全部为原创人物、原创台词、原创情节,不涉及任何版权作品。
 * 机制贯穿:对白 + 选择(选完当场不同反应 + 旗标影响结局)+ 说对台词 + 查案 + 旗标分支 + 多结局。
 */
export const ACT1: Script = {
  start: 'gate',
  scenes: {
    // ── 宫门:初入,行礼/直言当场不同 ──
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
            { label: '屈膝行礼,先递上见面礼', setFlags: ['polite'], goto: 'gateBow' },
            { label: '抬头直言,我是奉旨入宫', goto: 'gateBold' },
          ],
        },
      ],
    },
    gateBow: {
      id: 'gateBow',
      bg: 'gate',
      cast: ['laofu', 'xuetuan'],
      goto: 'courtyard',
      steps: [
        { kind: 'line', who: 'laofu', text: '(脸色稍缓)倒是个懂规矩的。罢了,进去吧——记着,这宫里规矩比天大。' },
      ],
    },
    gateBold: {
      id: 'gateBold',
      bg: 'gate',
      cast: ['laofu', 'xuetuan'],
      goto: 'courtyard',
      steps: [
        { kind: 'line', who: 'laofu', text: '(冷哼)牙尖嘴利。且看你这张利嘴,在这宫里能横到几时。' },
      ],
    },
    // ── 御花园:遇墨兰,信/疑当场不同(信她还得一条情报)──
    courtyard: {
      id: 'courtyard',
      bg: 'garden',
      cast: ['molan', 'xuetuan'],
      steps: [
        {
          kind: 'line',
          who: 'molan',
          text: '妹妹小心。金羽贵妃最容不得新人,前殿那一关,她定要给你个下马威。',
        },
        { kind: 'line', who: 'xuetuan', text: '姐姐何故提点我?这宫里,可没有白给的好意。' },
        {
          kind: 'choice',
          prompt: '墨兰主动示好,信她,还是留个心眼?',
          options: [
            { label: '谢姐姐相助,愿与你共进退', setFlags: ['trust_molan'], goto: 'cyTrust' },
            { label: '多谢提点,余事我自有分寸', goto: 'cyWary' },
          ],
        },
      ],
    },
    cyTrust: {
      id: 'cyTrust',
      bg: 'garden',
      cast: ['molan', 'xuetuan'],
      goto: 'meet',
      steps: [
        {
          kind: 'line',
          who: 'molan',
          text: '(压低声)好妹妹,爽快。那我便交你个底——金羽最忌讳人提她的出身,这话你记着,关键时用得上。',
        },
      ],
    },
    cyWary: {
      id: 'cyWary',
      bg: 'garden',
      cast: ['molan', 'xuetuan'],
      goto: 'meet',
      steps: [
        { kind: 'line', who: 'molan', text: '(神色一淡)也罢,各凭本事。只盼你别栽得太难看。' },
      ],
    },
    // ── 金銮殿:贵妃刁难,说对台词 ──
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
          context: '前殿初见,金羽贵妃当众刁难新入宫的雪团,满殿宫眷围观。',
          intent: '不卑不亢地化解贵妃的当众刁难——既不示弱讨饶,也不顶撞冒犯,把场面稳住、留有余地。',
          onPass: 'favor',
          onFail: 'snub',
        },
      ],
    },
    favor: {
      id: 'favor',
      bg: 'hall',
      cast: ['jinyu', 'xuetuan'],
      goto: 'incident',
      steps: [
        { kind: 'line', who: 'jinyu', text: '(冷笑)伶牙俐齿。这宫里,嘴利的活不长,咱们走着瞧。' },
        { kind: 'line', who: 'xuetuan', text: '一句话稳住了贵妃,可她眼里那点寒意,才是真正的开始。' },
      ],
    },
    incident: {
      id: 'incident',
      bg: 'garden',
      cast: ['molan', 'xuetuan'],
      goto: 'probe',
      steps: [
        { kind: 'line', who: 'molan', text: '不好了!贵妃的茶点里被人下了泻药,如今矛头都指向你这新人!' },
        { kind: 'line', who: 'xuetuan', text: '欲加之罪。可这罪名,我背不起——得自己查清楚。' },
      ],
    },
    probe: {
      id: 'probe',
      bg: 'garden',
      cast: ['molan', 'xuetuan'],
      steps: [
        { kind: 'line', who: 'molan', text: '当值的几只宫女狗都在这儿了。蛛丝马迹,就看你的眼力。' },
        {
          kind: 'deduce',
          prompt: '嗅出破绽,揪出在茶点里动手脚的那一只,替雪团自证清白。',
          count: 6,
          budget: 2,
          seed: 7,
          onSolve: 'vindicate',
          onFail: 'frame',
        },
      ],
    },
    // ── 金銮殿:洗冤,按结盟与否分两种好结局 ──
    vindicate: {
      id: 'vindicate',
      bg: 'hall',
      cast: ['xuetuan', 'jinyu'],
      steps: [
        { kind: 'line', who: 'xuetuan', text: '真凶落网,人证物证俱在。贵妃这一局,算是落了空。' },
        { kind: 'branch', flag: 'trust_molan', whenSet: 'winAlly', whenUnset: 'winSolo' },
      ],
    },
    winAlly: {
      id: 'winAlly',
      bg: 'hall',
      cast: ['molan', 'xuetuan'],
      steps: [
        { kind: 'line', who: 'molan', text: '我就说妹妹不是池中物。往后这宫里,你我互为奥援。' },
        {
          kind: 'ending',
          outcome: 'good',
          text: '【第一幕·终】洗清冤屈,初露锋芒,还结下了墨兰这门盟友。雪团在犬朝后宫,稳稳站住了第一步。',
        },
      ],
    },
    winSolo: {
      id: 'winSolo',
      bg: 'hall',
      cast: ['xuetuan'],
      steps: [
        { kind: 'line', who: 'xuetuan', text: '这一回,靠的是自己。这宫里,终究谁也指望不上。' },
        {
          kind: 'ending',
          outcome: 'good',
          text: '【第一幕·终】洗清冤屈,初露锋芒。雪团孤身一人,也在犬朝后宫站住了脚跟。',
        },
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
    frame: {
      id: 'frame',
      bg: 'garden',
      cast: ['jinyu', 'xuetuan'],
      steps: [
        { kind: 'line', who: 'jinyu', text: '查不出真凶?那这黑锅,就只好你这新人来背了。' },
        { kind: 'ending', outcome: 'bad', text: '【第一幕·冤】指错了人,雪团百口莫辩,被扣下了罪名。' },
      ],
    },
  },
};
