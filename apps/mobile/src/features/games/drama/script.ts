import type { Script } from './story';

/**
 * 犬朝后宫 · 第一幕《初入宫闱》+ 第二幕序。
 * 全部为原创人物、原创台词、原创情节,不涉及任何版权作品。
 * 选择一路有回响:行礼/直言(polite)、结盟/谨慎(trust_molan)在高潮处真起作用。
 */
export const ACT1: Script = {
  start: 'gate',
  scenes: {
    // ── 宫门:行礼/直言当场不同 ──
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
      steps: [{ kind: 'line', who: 'laofu', text: '(脸色稍缓)倒是个懂规矩的。罢了,进去吧——记着,这宫里规矩比天大。' }],
    },
    gateBold: {
      id: 'gateBold',
      bg: 'gate',
      cast: ['laofu', 'xuetuan'],
      goto: 'courtyard',
      steps: [{ kind: 'line', who: 'laofu', text: '(冷哼)牙尖嘴利。且看你这张利嘴,在这宫里能横到几时。' }],
    },
    // ── 御花园:结盟/谨慎,信她还得一条情报 ──
    courtyard: {
      id: 'courtyard',
      bg: 'garden',
      cast: ['molan', 'xuetuan'],
      steps: [
        { kind: 'line', who: 'molan', text: '妹妹小心。金羽贵妃最容不得新人,前殿那一关,她定要给你个下马威。' },
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
      steps: [{ kind: 'line', who: 'molan', text: '(压低声)好妹妹,爽快。那我便交你个底——金羽最忌讳人提她出身寒微,这话你记牢,关键时是把刀。' }],
    },
    cyWary: {
      id: 'cyWary',
      bg: 'garden',
      cast: ['molan', 'xuetuan'],
      goto: 'meet',
      steps: [{ kind: 'line', who: 'molan', text: '(神色一淡)也罢,各凭本事。只盼你别栽得太难看。' }],
    },
    // ── 金銮殿:贵妃刁难,说对台词 ──
    meet: {
      id: 'meet',
      bg: 'hall',
      cast: ['jinyu', 'xuetuan'],
      steps: [
        { kind: 'line', who: 'jinyu', text: '哟,这就是新来的雪团？瞧这怯生生的样子,也敢来争宠?当众说句话听听。' },
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
    // ── 高潮:金羽反扑,旗标在此见真章 ──
    vindicate: {
      id: 'vindicate',
      bg: 'hall',
      cast: ['xuetuan', 'jinyu'],
      goto: 'retaliate',
      steps: [{ kind: 'line', who: 'xuetuan', text: '真凶落网,人证物证俱在。可贵妃的脸色,却没半分败相——' }],
    },
    retaliate: {
      id: 'retaliate',
      bg: 'hall',
      cast: ['jinyu', 'xuetuan'],
      steps: [
        { kind: 'line', who: 'jinyu', text: '哼,一桩查清了又如何。你方才在殿上目无尊卑、出言无状,这失仪之罪,可不是查案能洗的。' },
        // 结盟过 → 手里有情报,多一条以攻代守的路
        { kind: 'branch', flag: 'trust_molan', whenSet: 'gambit', whenUnset: 'prep' },
      ],
    },
    gambit: {
      id: 'gambit',
      bg: 'hall',
      cast: ['xuetuan', 'jinyu'],
      steps: [
        { kind: 'line', who: 'xuetuan', text: '(心念一转)墨兰交我的那条——金羽最忌讳的出身。此刻被她步步紧逼,正是用它的时候。' },
        {
          kind: 'choice',
          prompt: '手里攥着贵妃的软肋,怎么走这一步?',
          options: [
            { label: '当众点破她出身寒微,以攻代守', goto: 'triumph' },
            { label: '不愿伤人,堂堂正正回应', goto: 'prep' },
          ],
        },
      ],
    },
    // 礼数周全过 → 老福危急时替你作证;否则只能独自面对
    prep: {
      id: 'prep',
      bg: 'hall',
      cast: ['xuetuan'],
      steps: [{ kind: 'branch', flag: 'polite', whenSet: 'vouch', whenUnset: 'alone' }],
    },
    vouch: {
      id: 'vouch',
      bg: 'hall',
      cast: ['laofu', 'xuetuan'],
      goto: 'finalSay',
      steps: [{ kind: 'line', who: 'laofu', text: '(上前一步)贵妃明鉴。这答应入宫时守礼周全,殿上失态不过是受了惊,老身愿替她作个见证。' }],
    },
    alone: {
      id: 'alone',
      bg: 'hall',
      cast: ['xuetuan'],
      goto: 'finalSay',
      steps: [{ kind: 'line', who: 'xuetuan', text: '满殿无人替我说话。也好——这一关,本就该自己扛过去。' }],
    },
    finalSay: {
      id: 'finalSay',
      bg: 'hall',
      cast: ['jinyu', 'xuetuan'],
      steps: [
        {
          kind: 'sayline',
          who: 'jinyu',
          context: '金羽贵妃以"殿上失仪、目无尊卑"为由二次发难,要把罪名扣到雪团头上,满殿宫眷围观。',
          intent: '顶住贵妃的二次发难——把"失仪"之罪四两拨千斤地化解,既守住分寸,又反将一军、让她无从发作。',
          onPass: 'triumph',
          onFail: 'downfall',
        },
      ],
    },
    triumph: {
      id: 'triumph',
      bg: 'hall',
      cast: ['jinyu', 'xuetuan'],
      goto: 'act2',
      steps: [
        { kind: 'line', who: 'jinyu', text: '(脸色铁青,拂袖)……今日,算你伶俐。' },
        { kind: 'line', who: 'xuetuan', text: '贵妃这一局,落了空。可我知道,这梁子,结下了。' },
      ],
    },
    downfall: {
      id: 'downfall',
      bg: 'hall',
      cast: ['jinyu', 'xuetuan'],
      steps: [
        { kind: 'line', who: 'jinyu', text: '一桩失仪,再添一桩顶撞。来人,把这不知天高地厚的答应,押下去。' },
        { kind: 'ending', outcome: 'bad', text: '【第一幕·折】洗清了投毒的冤,却折在金羽的反扑上。雪团这一步,终究没站稳。' },
      ],
    },
    // ── 第二幕 · 序 ──
    act2: {
      id: 'act2',
      bg: 'garden',
      cast: ['xuetuan', 'molan'],
      steps: [
        { kind: 'line', who: 'molan', text: '数月光景,妹妹已从答应晋了常在。这后宫的水,你算是踩稳了头一脚。' },
        { kind: 'line', who: 'xuetuan', text: '踩稳一脚,不代表站得久。金羽不会善罢甘休,而圣眷……才是这宫里真正的风向。' },
        {
          kind: 'choice',
          prompt: '【第二幕】晋了常在,接下来这步棋,先落在哪?',
          options: [
            { label: '稳扎稳打,先固住眼下的位分', goto: 'act2end' },
            { label: '剑走偏锋,设法争一回圣眷', goto: 'act2end' },
          ],
        },
      ],
    },
    act2end: {
      id: 'act2end',
      bg: 'garden',
      cast: ['xuetuan'],
      steps: [
        {
          kind: 'ending',
          outcome: 'good',
          text: '【第一幕·终 ｜ 第二幕·序】初入宫闱,雪团洗冤、立威、晋位,在犬朝后宫稳稳站住了脚跟。更深的风浪,正在前方——(第二幕,待续)',
        },
      ],
    },
    // ── 早段坏结局 ──
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
