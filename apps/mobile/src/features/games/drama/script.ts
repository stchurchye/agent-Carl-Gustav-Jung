import type { Script } from './story';

/**
 * 犬朝后宫 ·《雪团传》全本:四幕原创宫斗。
 * 全部为原创人物、原创台词、原创情节——宫斗只是类型套路(不受版权),不照搬、不"小改"任何作品。
 *
 * 旗标一路贯穿、皆有回响(无死旗标):
 *  - polite(行礼)        → 老福三度作证:vouch / vouch2 / laofuFinal
 *  - trust_molan(结盟)    → 墨兰给情报、解锁隐藏贤宠、第三幕拼死相救的羁绊
 *  - humiliated_jinyu(点破)→ 第三幕金羽的报复变成血海深仇
 *  - glory(锋芒夺宠)      → 第四幕金羽纠集的党羽更盛
 *  - saved_molan / cold_blood(救/弃墨兰)→ 第四幕站着的是盟友还是孤影,决定终局
 *
 * 每幕"善果"续进下一幕,只有第四幕才是真正的大结局;各幕"恶果"即game over(有画面的重击)。
 */
export const ACT1: Script = {
  start: 'gate',
  scenes: {
    // ══════════ 第一幕《初入宫闱》 ══════════
    gate: {
      id: 'gate',
      bg: 'gate',
      act: '第一幕 · 初入宫闱',
      cast: ['laofu', 'xuetuan'],
      steps: [
        { kind: 'line', who: 'laofu', text: '新来的答应?规矩还没学全,就敢往前凑。' },
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
      steps: [{ kind: 'line', who: 'laofu', text: '(冷哼)嘴上倒不饶人。老身把过的这道门,进得来的多,出得去的少——你这股锐气,留着慢慢磨吧。' }],
    },
    courtyard: {
      id: 'courtyard',
      bg: 'garden',
      cast: ['molan', 'xuetuan'],
      steps: [
        { kind: 'line', who: 'molan', text: '妹妹小心。金羽贵妃最容不得新人,前殿那一关,她定要给你个下马威。' },
        { kind: 'line', who: 'xuetuan', text: '(怔了怔)姐姐肯对我这生面孔说这些……雪团一时,竟不知该不该信。' },
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
      steps: [{ kind: 'line', who: 'molan', text: '(压低声)好妹妹,爽快。那我便交你个底——金羽靠娘家权势得位,最忌讳人提她出身寒微。这话你记牢,关键时是把刀。' }],
    },
    cyWary: {
      id: 'cyWary',
      bg: 'garden',
      cast: ['molan', 'xuetuan'],
      goto: 'meet',
      steps: [{ kind: 'line', who: 'molan', text: '(神色一淡)也罢。这宫里没人能护你周全——只记着一句:金羽的人惯用下药栽赃,真到那天,全看你自己的眼力。' }],
    },
    meet: {
      id: 'meet',
      bg: 'hall',
      cast: ['jinyu', 'xuetuan'],
      steps: [
        { kind: 'line', who: 'jinyu', text: '哟,这就是新来的雪团?瞧这怯生生的样子,也敢来争宠?当众说句话听听。' },
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
        { kind: 'line', who: 'jinyu', text: '(冷笑)倒是伶俐。只是这宫里,会说话的多了去,能说到最后的,没几个。本宫,等着看你。' },
        { kind: 'line', who: 'xuetuan', text: '贵妃认了输,眼底却结着冰。我知道她不会让我好过——只是没想到,来得这样快。' },
      ],
    },
    incident: {
      id: 'incident',
      bg: 'garden',
      cast: ['molan', 'xuetuan'],
      goto: 'probe',
      steps: [
        { kind: 'line', who: 'molan', text: '(疾步而入,声音发抖)妹妹,出事了!贵妃的茶点里被人掺了药,她当殿呕得直不起身,正咬定是你下的手!掌刑的嬷嬷已经在备杖了——' },
        { kind: 'line', who: 'molan', text: '她放了话:午时三刻前查不出真凶,就拿你抵罪。这满宫的眼睛,这会儿全钉在你身上。' },
        { kind: 'line', who: 'xuetuan', text: '(指尖发凉)欲加之罪,何患无辞。可这盆脏水我接不住——是非曲直,只能我自己去寻。' },
      ],
    },
    probe: {
      id: 'probe',
      bg: 'garden',
      cast: ['molan', 'xuetuan'],
      steps: [
        { kind: 'line', who: 'molan', text: '当值的几只宫女狗都在这儿了。蛛丝马迹,就看你的眼力——午时的梆子,可不等人。' },
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
    vindicate: {
      id: 'vindicate',
      bg: 'hall',
      cast: ['xuetuan', 'jinyu'],
      goto: 'retaliate',
      steps: [{ kind: 'line', who: 'xuetuan', text: '真凶被押了下去。我刚松口气,抬眼却撞上金羽——她非但不慌,唇角竟慢慢勾起来,像看着一只刚跳出陷阱、又踩进另一张网的猎物。' }],
    },
    retaliate: {
      id: 'retaliate',
      bg: 'hall',
      cast: ['jinyu', 'xuetuan'],
      steps: [
        { kind: 'line', who: 'jinyu', text: '(踱近一步,声音压得极低,只够雪团听见)查得清投毒,洗不清失仪。你方才在殿上目无尊卑、出言无状——这一条,没有真凶,只有你。(转身扬声)来人,请掌仪嬷嬷评一评,这答应当殿失仪,该当何罪!' },
        // 结盟过 → 手里有情报,多一条以攻代守的险路
        { kind: 'branch', flag: 'trust_molan', whenSet: 'gambit', whenUnset: 'prep' },
      ],
    },
    gambit: {
      id: 'gambit',
      bg: 'hall',
      cast: ['xuetuan', 'jinyu'],
      steps: [
        { kind: 'line', who: 'xuetuan', text: '(心头一冷)她步步进逼,是要把我逼死在这殿上。可她忘了——墨兰早把她那块逆鳞,放进了我手心。该不该亮这张牌?' },
        {
          kind: 'choice',
          prompt: '手里攥着贵妃的死穴,这一步怎么走?',
          options: [
            // 狠路:要亲口说到位才反将得了军;且自此与金羽结下血仇
            { label: '当众点破她出身寒微,以攻代守(她会记你一辈子的仇)', setFlags: ['humiliated_jinyu'], goto: 'gambitSay' },
            // 仁路:丢掉这记稳赢,硬着头皮自证
            { label: '不愿伤人,把这张牌咽回去,堂堂正正回应', goto: 'gambitClean' },
          ],
        },
      ],
    },
    gambitSay: {
      id: 'gambitSay',
      bg: 'hall',
      cast: ['jinyu', 'xuetuan'],
      steps: [
        {
          kind: 'sayline',
          who: 'jinyu',
          context: '金羽以"失仪"之罪步步紧逼。雪团决意用墨兰给的"出身寒微"这块死穴,当殿反将一军。',
          intent: '一刀点破金羽的命门、以攻代守反将一军——既要够狠够准戳到她的痛处,又要话锋藏在分寸里,不显得泼辣失态、反落人口实。',
          onPass: 'triumph',
          onFail: 'downfall',
        },
      ],
    },
    gambitClean: {
      id: 'gambitClean',
      bg: 'hall',
      cast: ['xuetuan'],
      steps: [
        { kind: 'line', who: 'xuetuan', text: '(攥紧了袖)这话一出口,她这辈子就毁了。我赢得起——可我不愿这么赢。' },
        { kind: 'branch', flag: 'polite', whenSet: 'vouch', whenUnset: 'alone' },
      ],
    },
    prep: {
      id: 'prep',
      bg: 'hall',
      cast: ['xuetuan'],
      steps: [
        { kind: 'line', who: 'xuetuan', text: '殿上鸦雀无声。我攥紧了袖中的手——这一关,得看还有没有人,肯替我说一句话。' },
        { kind: 'branch', flag: 'polite', whenSet: 'vouch', whenUnset: 'alone' },
      ],
    },
    vouch: {
      id: 'vouch',
      bg: 'hall',
      cast: ['laofu', 'xuetuan'],
      goto: 'finalSay',
      steps: [{ kind: 'line', who: 'laofu', text: '(上前一步)贵妃明鉴。这答应入宫时守礼周全,殿上失态不过是受了惊。老身把了几十年的宫门,看得出谁是奸、谁是怯——愿替她作个见证。' }],
    },
    alone: {
      id: 'alone',
      bg: 'hall',
      cast: ['xuetuan'],
      goto: 'finalSay',
      steps: [{ kind: 'line', who: 'xuetuan', text: '满殿珠翠,竟无一人肯为我开口。也好——孤身入局,本就没指望谁来搭一把手。' }],
    },
    finalSay: {
      id: 'finalSay',
      bg: 'hall',
      cast: ['jinyu', 'xuetuan'],
      steps: [
        {
          kind: 'sayline',
          who: 'jinyu',
          context: '金羽以"殿上失仪、目无尊卑"二次发难,要把罪名扣到雪团头上,满殿宫眷围观。',
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
        { kind: 'line', who: 'xuetuan', text: '贵妃这一局,落了空。可我知道,这梁子,结下了——往后的每一步,都得踩着刀尖走。' },
      ],
    },
    // ── 第一幕 · 三处恶果(game over,皆有画面)──
    snub: {
      id: 'snub',
      bg: 'hall',
      cast: ['jinyu', 'xuetuan'],
      steps: [
        { kind: 'line', who: 'jinyu', text: '就这点本事,也配进这后宫?来人,送答应回去好好学规矩。' },
        {
          kind: 'ending',
          outcome: 'bad',
          text: '【第一幕·挫】话到嘴边却乱了方寸,满殿哄笑像针一样扎下来。金羽只一句「送回去学规矩」,雪团便被拖出殿外,发上的步摇磕在门槛上,断成两截。冷宫的门在身后合拢——她还没看清这后宫,就先输掉了入场的资格。',
        },
      ],
    },
    frame: {
      id: 'frame',
      bg: 'garden',
      cast: ['jinyu', 'xuetuan'],
      steps: [
        {
          kind: 'ending',
          outcome: 'bad',
          text: '【第一幕·冤】她指错了那一只。真凶在人群里垂下头,嘴角却悄悄翘了起来。午时三刻的梆子声响过,掌刑嬷嬷上前一步——「投毒之罪,证据确凿。」雪团想喊冤,满殿却没有一张嘴肯为她张开。墨兰别过脸去,那一眼里,是再也帮不了你的歉。这后宫记得每一个输家,却从不记得他们冤不冤。',
        },
      ],
    },
    downfall: {
      id: 'downfall',
      bg: 'hall',
      cast: ['jinyu', 'xuetuan'],
      steps: [
        { kind: 'line', who: 'jinyu', text: '一桩失仪,再添一桩顶撞。来人,把这不知天高地厚的答应,押下去!' },
        {
          kind: 'ending',
          outcome: 'bad',
          text: '【第一幕·折】洗清了投毒的冤,却折在金羽的反扑上。一句话没接住,失仪之罪坐实,雪团被押出大殿。这一步没站稳,后头万丈深的路,她再没机会走了。',
        },
      ],
    },

    // ══════════ 第二幕《御宴争辉》 ══════════
    act2: {
      id: 'act2',
      bg: 'garden',
      act: '第二幕 · 御宴争辉',
      cast: ['xuetuan', 'molan'],
      goto: 'banquetNews',
      steps: [
        { kind: 'line', who: 'molan', text: '数月光景,妹妹已从答应晋了嫔位。这后宫的水,你总算踩稳了头一脚。' },
        { kind: 'line', who: 'xuetuan', text: '踩稳一脚,不代表站得久。金羽断不会善罢甘休——而真正的风向,从来在圣眷那头。' },
      ],
    },
    banquetNews: {
      id: 'banquetNews',
      bg: 'garden',
      cast: ['molan', 'xuetuan'],
      steps: [
        { kind: 'line', who: 'molan', text: '妹妹,有桩要紧事——中秋陛下要设诗宴,六宫齐集,这是你头一回能近圣颜。可金羽那边早撂下了狠话,要叫你在御前栽个大跟头。你,得早早有个准备。' },
        { kind: 'line', who: 'xuetuan', text: '(眸光一凝)躲是躲不过的。既然推到了御前,这一回圣眷,我偏要争。' },
        { kind: 'branch', flag: 'trust_molan', whenSet: 'intelGet', whenUnset: 'noIntel' },
      ],
    },
    intelGet: {
      id: 'intelGet',
      bg: 'garden',
      cast: ['molan', 'xuetuan'],
      goto: 'court',
      steps: [
        { kind: 'line', who: 'molan', text: '(附耳低语)交你句要紧的——陛下最厌空泛的颂圣谀词,独爱咏物言志。你若开口,要借眼前之物吐胸中之志,切莫堆砌华藻。这话,能救你一回。' },
      ],
    },
    noIntel: {
      id: 'noIntel',
      bg: 'garden',
      cast: ['xuetuan'],
      goto: 'court',
      steps: [{ kind: 'line', who: 'xuetuan', text: '无人替我通风报信。圣心深似海,这一回,只能凭自己一张嘴、一颗胆。' }],
    },
    court: {
      id: 'court',
      bg: 'hall',
      cast: ['quanhuang', 'xuetuan'],
      steps: [
        { kind: 'line', who: 'xuetuan', text: '(垂首,听得见自己的心跳)御座上那道目光落下来,满殿瞬间噤了声。一句说对,是青云;说错,连金羽都不必动手——圣心一冷,我便万劫不复。' },
        { kind: 'line', who: 'quanhuang', text: '(声音不高,殿中却落针可闻)雪团,抬起头。朕这一问,问的不是辞藻——是你这颗心,配不配站在这儿。' },
        {
          kind: 'sayline',
          who: 'quanhuang',
          context: '中秋御宴,雪团初次面圣。满殿宫眷环伺,金羽贵妃在侧冷眼旁观,犬皇命她当众开口——一句话定青云或万劫。',
          intent: '初面圣颜——不卑不亢、得体而出彩,既不谄媚逢迎,也不失了分寸,要在一句话里引起圣意、又不逾越本分。',
          onPass: 'scheme',
          onFail: 'favorLost',
        },
      ],
    },
    scheme: {
      id: 'scheme',
      bg: 'hall',
      cast: ['jinyu', 'xuetuan'],
      steps: [
        { kind: 'line', who: 'jinyu', text: '(盈盈出列)陛下明鉴。一个入宫未久的新人,何德何能,也忝列御宴?臣妾私下听闻,她暗结内监、买通了这御前的座次——御宴舞弊,这罪,可不轻。' },
        { kind: 'branch', flag: 'polite', whenSet: 'vouch2', whenUnset: 'alone2' },
      ],
    },
    vouch2: {
      id: 'vouch2',
      bg: 'hall',
      cast: ['laofu', 'xuetuan'],
      goto: 'plot',
      steps: [
        { kind: 'line', who: 'laofu', text: '(持册上前)陛下,御宴座次皆由老身按位分排定,名册在此,无半分舞弊。这位主子入宫时守礼周全,贵妃这泼天的罪名,老身第一个担不起。' },
      ],
    },
    alone2: {
      id: 'alone2',
      bg: 'hall',
      cast: ['xuetuan'],
      goto: 'plot',
      steps: [{ kind: 'line', who: 'xuetuan', text: '满殿无人替我开口。这盆脏水泼下来,只能自己接住、自己洗净——退一步,便是万丈深渊。' }],
    },
    plot: {
      id: 'plot',
      bg: 'hall',
      cast: ['xuetuan', 'molan'],
      steps: [
        { kind: 'line', who: 'xuetuan', text: '(低呼)偏在这节骨眼——进上的御酒里,有人动了手脚,杯底残着不该有的腌臜,矛头又往我这儿引!' },
        {
          kind: 'deduce',
          prompt: '御宴执役的宫人就在眼前。嗅出在御酒里下手、要把你拖下水的那一只,当殿揪出真凶。',
          count: 7,
          budget: 2,
          seed: 11,
          onSolve: 'duel',
          onFail: 'banquetFrame',
        },
      ],
    },
    duel: {
      id: 'duel',
      bg: 'hall',
      cast: ['quanhuang', 'jinyu'],
      steps: [
        { kind: 'line', who: 'quanhuang', text: '(徐徐开口)闹了这一场,朕的兴致倒被勾了起来。今夜月好,便以月为题,各赋一句与朕听。雪团,你也拟一句来。' },
        { kind: 'line', who: 'jinyu', text: '(掩唇)陛下有所不知,这位出身寒微,针线尚且生疏,何况笔墨?臣妾是怕她一句拙词,污了陛下今夜的雅兴——输了,可别哭着求陛下开恩。' },
        {
          kind: 'choice',
          prompt: '金羽以出身相激,御前赋诗这一关,你怎么走?',
          options: [
            // 锋芒:博一记当众压她的耀眼,但从此树大敌
            { label: '锋芒毕露,以才情正面斗诗、压她一头', setFlags: ['glory'], goto: 'sharpSay' },
            // 藏锋:不争而争,留得贤名(双旗标全 → 隐藏贤宠)
            { label: '藏锋守拙,以谦德自持、反衬她咄咄逼人', goto: 'humbleSay' },
          ],
        },
      ],
    },
    sharpSay: {
      id: 'sharpSay',
      bg: 'hall',
      cast: ['quanhuang', 'xuetuan'],
      steps: [
        {
          kind: 'sayline',
          who: 'quanhuang',
          context: '御宴赋诗,金羽当众讥讽雪团出身微末、要逼她露怯。你选了正面相争,要以一句咏月之词技惊四座、当殿压贵妃一头。',
          intent: '借中秋之月咏物言志、抒胸中抱负——以真才情技惊满座、锋利而不轻浮,既压金羽的讥诮,又入犬皇的眼。',
          onPass: 'talentWin',
          onFail: 'duelLost',
        },
      ],
    },
    humbleSay: {
      id: 'humbleSay',
      bg: 'hall',
      cast: ['quanhuang', 'xuetuan'],
      steps: [
        {
          kind: 'sayline',
          who: 'quanhuang',
          context: '御宴赋诗,金羽以出身相激、咄咄逼人。你选了藏锋,要以谦逊化解,把贵妃的盛气反衬成失度。',
          intent: '以谦逊自持、以退为进——一句话谦而不卑、柔中带骨,既不与贵妃争锋,又让满殿看出她的咄咄、衬出你的端方,把圣心引向贤德。',
          onPass: 'virtueWin',
          onFail: 'duelLost',
        },
      ],
    },
    // ── 锋芒之巅:耀眼夺宠,也树满身敌(glory)──
    talentWin: {
      id: 'talentWin',
      bg: 'hall',
      cast: ['quanhuang', 'xuetuan'],
      goto: 'act3',
      steps: [
        { kind: 'line', who: 'quanhuang', text: '(目光骤亮,一掌按在御案上)好——满座颂圣的辞藻,朕听了三年,倒不及她这一句锋利。出身微末又何妨?朕要的,从不是温吞的贤静,是这把藏不住的锋。来人,赐东珠一斛,晋一阶,以彰其才。' },
        { kind: 'line', who: 'xuetuan', text: '(一句咏月,刀光似的劈开满殿珠翠。金羽当场白了脸)这后宫头一回,有人在御前抢了贵妃的彩。我赢得耀眼——也赢得满身的敌意。' },
      ],
    },
    // ── 藏锋之归:不争而争;双旗标全 → 隐藏贤宠 ──
    virtueWin: {
      id: 'virtueWin',
      bg: 'hall',
      cast: ['quanhuang', 'xuetuan'],
      steps: [
        { kind: 'line', who: 'quanhuang', text: '(颔首)满殿争奇斗艳,偏你这一句不争,听着最干净。这份贤静端方,倒比满座珠翠更入朕的眼。' },
        { kind: 'branch', flag: 'trust_molan', whenSet: 'virtueCheck', whenUnset: 'virtuePlain' },
      ],
    },
    virtueCheck: {
      id: 'virtueCheck',
      bg: 'hall',
      cast: ['xuetuan'],
      steps: [{ kind: 'branch', flag: 'polite', whenSet: 'hiddenWin', whenUnset: 'virtuePlain' }],
    },
    hiddenWin: {
      id: 'hiddenWin',
      bg: 'hall',
      cast: ['quanhuang', 'xuetuan'],
      goto: 'act3',
      steps: [
        { kind: 'line', who: 'xuetuan', text: '【隐藏 · 贤宠】墨兰的密语让我摸准了圣心,老福的作证替我正了清名——内外皆备,滴水不漏。犬皇赞我贤德端方,晋为妃,赐居椒房。满宫艳羡,唯我自知:这一步登天,是一子一子落出来的。' },
      ],
    },
    virtuePlain: {
      id: 'virtuePlain',
      bg: 'hall',
      cast: ['quanhuang', 'xuetuan'],
      goto: 'act3',
      steps: [
        { kind: 'line', who: 'xuetuan', text: '不争而争,贤德稳重得了犬皇看重,圣眷绵长。我在这后宫,又稳稳进了一阶——只是这份安稳,在金羽眼里,大约又是一根扎心的刺。' },
      ],
    },
    // ── 第二幕 · 三处恶果(game over)──
    favorLost: {
      id: 'favorLost',
      bg: 'hall',
      cast: ['jinyu', 'xuetuan'],
      steps: [
        { kind: 'line', who: 'jinyu', text: '(掩不住得意)瞧见了么,陛下?上不得台面的,终究是上不得台面。' },
        {
          kind: 'ending',
          outcome: 'bad',
          text: '【御宴争辉 · 面圣失仪】御座那一问,她答得慌了神。犬皇的目光淡淡移开,只这一移,金羽的眼里便亮了。这一回失了圣眷,跌回原处——她把今日刻进了心里,却再没了来日。',
        },
      ],
    },
    duelLost: {
      id: 'duelLost',
      bg: 'hall',
      cast: ['jinyu', 'xuetuan'],
      steps: [
        { kind: 'line', who: 'jinyu', text: '(轻笑出声)方才殿上那点伶牙俐齿呢?真到了见真章的时候,竟连半句囫囵话也吐不出——本宫早说了,上不得台面的,终归上不得台面。' },
        {
          kind: 'ending',
          outcome: 'bad',
          text: '【御宴争辉 · 当众露怯】御前赋诗,她搜肠刮肚,半晌只憋出几个零碎的字。犬皇的眉头几不可察地一蹙,移开了目光——就这一蹙,比任何责罚都重。满殿的窃笑像潮水漫上来,雪团知道:圣心,再不会落到她身上了。',
        },
      ],
    },
    banquetFrame: {
      id: 'banquetFrame',
      bg: 'hall',
      cast: ['jinyu', 'xuetuan'],
      steps: [
        {
          kind: 'ending',
          outcome: 'bad',
          text: '【御宴争辉 · 栽赃】她指错了人。金羽抢上一步,盈盈跪倒:「陛下,舞弊在前,毒酒在后,这样的人混在御宴上,是对圣驾的大不敬。」犬皇沉默良久,只淡淡两个字:「拖下去。」——方才还离圣眷只一步之遥,转眼便被拖出殿门。月光照在空了的座次上,像从没有人来过。',
        },
      ],
    },

    // ══════════ 第三幕《棠梨惊变》〔揪心〕 ══════════
    act3: {
      id: 'act3',
      bg: 'garden',
      act: '第三幕 · 棠梨惊变',
      cast: ['xuetuan', 'molan'],
      steps: [
        { kind: 'line', who: 'xuetuan', text: '入宫一年,我从答应走到了妃位。可越是站得高,夜里越是睡不安稳——金羽沉得太久了,静得反常。' },
        { kind: 'line', who: 'molan', text: '(脸色惨白,几乎站不住)妹妹……我怕是要连累你了。她们在我屋里,搜出了一个东西。' },
        { kind: 'branch', flag: 'humiliated_jinyu', whenSet: 'act3a', whenUnset: 'act3b' },
      ],
    },
    act3a: {
      id: 'act3a',
      bg: 'hall',
      cast: ['jinyu', 'molan'],
      goto: 'act3crisis',
      steps: [
        { kind: 'line', who: 'jinyu', text: '(俯身,一字一句,恨意森然)你当众撕本宫脸皮那日,本宫就盘算清楚了——杀你,太便宜。本宫要你亲眼看着那个肯把后背交给你的人,因你而死;往后你每回想信谁,先想想墨兰是怎么没的。这,才叫还。' },
      ],
    },
    act3b: {
      id: 'act3b',
      bg: 'hall',
      cast: ['jinyu', 'molan'],
      goto: 'act3crisis',
      steps: [
        { kind: 'line', who: 'jinyu', text: '(气定神闲)扳不倒你这棵树,本宫便先伐你身边的枝。墨兰跟你最近,拿她开刀,既除了你一条臂膀,又够你疼上好一阵。' },
      ],
    },
    act3crisis: {
      id: 'act3crisis',
      bg: 'hall',
      cast: ['molan', 'xuetuan'],
      steps: [
        { kind: 'line', who: 'molan', text: '(声音抖得不成调)一根刻着陛下名讳、扎满银针的啃骨……巫蛊厌胜,这是要诛九族的死罪啊!那东西不是我的,是有人塞进来的——可满宫谁信我?' },
        { kind: 'line', who: 'xuetuan', text: '(心一沉)金羽这一刀,捅的不是墨兰——是我。我若上前回护,便是同党,这一年挣的全得搭进去;我若撇清,墨兰今夜就得死。' },
        {
          kind: 'choice',
          prompt: '巫蛊大罪当前,墨兰跪在殿中等死。你怎么选?',
          options: [
            { label: '挺身回护,拼着自己一起栽,也要保她', setFlags: ['saved_molan'], goto: 'defend' },
            { label: '当殿割席、反踩一脚向金羽递投名状——这一弃,换她收手,是你离凤位最近的一次', setFlags: ['cold_blood'], goto: 'forsake' },
          ],
        },
      ],
    },
    defend: {
      id: 'defend',
      bg: 'hall',
      cast: ['xuetuan', 'molan'],
      goto: 'detain',
      steps: [
        { kind: 'line', who: 'xuetuan', text: '(上前半步,挡在墨兰身前)陛下!巫蛊乃灭门重罪,定罪岂能凭一根来路不明的啃骨?容臣妾把栽赃的人,揪出来给陛下看!' },
      ],
    },
    // 推箱子脱困:金羽抢先把雪团软禁库房,得推宫箱开暗门冲回公堂——慢一步墨兰就没命
    detain: {
      id: 'detain',
      bg: 'gate',
      cast: ['jinyu', 'xuetuan'],
      steps: [
        { kind: 'line', who: 'jinyu', text: '(抢上一步,假意关切)妹妹怕是急糊涂了。来人——送娘娘去偏殿库房歇着,公堂上的事,可容不得她这样搅。' },
        { kind: 'line', who: 'xuetuan', text: '(库房门哐当落锁,四下堆满宫箱)她是要把我关到公堂散场!可巧——地砖上那几处机关,把箱子全压上去,暗门就开。墨兰还跪在堂上等我,一刻都耽误不得!' },
        {
          kind: 'sokoban',
          prompt: '推开宫箱、把四角地砖机关全压上,撬开暗门冲回公堂——慢一步,墨兰就没命了。',
          onSolve: 'a3probe',
          onFail: 'caught',
        },
      ],
    },
    a3probe: {
      id: 'a3probe',
      bg: 'hall',
      cast: ['xuetuan', 'molan'],
      steps: [
        { kind: 'line', who: 'xuetuan', text: '(暗门轰然洞开,我踉跄冲回公堂)还来得及!当值的宫人都在这儿——谁动的手,这一回,我要当着满堂揪出来。' },
        {
          kind: 'deduce',
          prompt: '近三日出入过墨兰寝殿的宫人都在此。嗅出谁的爪上沾着新刻啃骨的骨屑气、谁是金羽埋的钉子——揪出栽赃的真凶。',
          count: 7,
          budget: 2,
          seed: 13,
          onSolve: 'expose',
          onFail: 'bothFall',
        },
      ],
    },
    caught: {
      id: 'caught',
      bg: 'gate',
      cast: ['xuetuan'],
      steps: [
        {
          kind: 'ending',
          outcome: 'bad',
          text: '【棠梨惊变 · 困毙】箱笼推来推去,暗门却始终不开。库房外,公堂的梆子一声声敲过去——等她终于颓然松了爪,墨兰的死讯,已隔着那道门传了进来。金羽要的从不是她的命,是要她困在咫尺之外,眼睁睁看着自己,救不下那个唯一肯信她的人。',
        },
      ],
    },
    expose: {
      id: 'expose',
      bg: 'hall',
      cast: ['xuetuan', 'quanhuang'],
      steps: [
        { kind: 'line', who: 'xuetuan', text: '(攥着那截沾骨屑的衣料)真凶招了:那根扎针的啃骨,是这宫人奉金羽之命连夜刻好、塞进墨兰房中的。可金羽是贵妃,空口指认她,反成了我的"攀诬之罪"。' },
        {
          kind: 'sayline',
          who: 'quanhuang',
          context: '雪团揪出了栽赃的宫人,但要当着满殿、当着犬皇,把这桩巫蛊伪案的主谋——贵妃金羽,钉死在殿上,救下将死的墨兰。',
          intent: '把这桩巫蛊伪案反扣回金羽头上——以铁证为锋、以情理为刃,既要救下墨兰,又要让满殿无可辩驳、让犬皇不得不信,而不显得是攀诬贵妃。',
          onPass: 'act3win',
          onFail: 'silenced',
        },
      ],
    },
    act3win: {
      id: 'act3win',
      bg: 'hall',
      cast: ['xuetuan', 'molan'],
      goto: 'act4',
      steps: [
        { kind: 'line', who: 'quanhuang', text: '(声色俱厉)好一出贼喊捉贼!金羽,自导这等巫蛊污案、构陷宫嫔,先褫你协理六宫之权,闭门思过!' },
        { kind: 'line', who: 'molan', text: '(泪如雨下,死死攥住雪团的手)是你……是你拿自家性命,从那三尺白绫底下,把我夺了回来。这条命,从今往后,便是你的了。' },
        { kind: 'line', who: 'xuetuan', text: '我赢了这一局,也彻底撕破了脸。金羽被削了权,只会比从前更疯——下一回,她要的就是我的命了。' },
      ],
    },
    forsake: {
      id: 'forsake',
      bg: 'hall',
      cast: ['xuetuan', 'molan', 'jinyu'],
      goto: 'act4',
      steps: [
        { kind: 'line', who: 'molan', text: '(难以置信地望着她,声音碎了)妹妹……连你也别过脸去么?当初是你说的,要与我共进退……' },
        { kind: 'line', who: 'jinyu', text: '(似笑非笑)识时务者为俊杰。本宫赏你看清了这宫里的规矩——人心,比命贱。' },
        { kind: 'line', who: 'xuetuan', text: '(别开脸,声音稳得自己都怕)……臣妾与她素无深交。拖下去吧。(白绫掠过墨兰脖颈的那一瞬,我死死盯着自己的鞋尖,没敢抬头——她那双扶过我凤裾的爪子,临了,还朝我虚虚伸了一下。)' },
        { kind: 'line', who: 'xuetuan', text: '棠梨树下的血还没干,我已经不是入宫时那个雪团了。从今往后,我只剩自己。' },
      ],
    },
    // ── 第三幕 · 两处恶果(game over)──
    bothFall: {
      id: 'bothFall',
      bg: 'hall',
      cast: ['jinyu', 'xuetuan'],
      steps: [
        {
          kind: 'ending',
          outcome: 'bad',
          text: '【棠梨惊变 · 同戮】她查错了人,反被金羽倒咬一口:「妃位也敢替巫蛊之徒翻案,可见是一党!」铁证没找着,攀诬之罪倒坐实了。墨兰被拖出去时没有回头,只丢下一句轻得几乎听不见的「当初真不该信,这宫里会有真心」。两道催命的旨意,先后落下。棠梨花落了满地,没人记得这宫里曾有过两个相互递过真心的人。',
        },
      ],
    },
    silenced: {
      id: 'silenced',
      bg: 'hall',
      cast: ['jinyu', 'xuetuan'],
      steps: [
        {
          kind: 'ending',
          outcome: 'bad',
          text: '【棠梨惊变 · 噤口】真凶就在眼前,她却没能把话说圆。金羽抢白一句「妃位空口攀诬本宫,该当何罪」,满殿的风向霎时倒转。证据被按下,墨兰被定了死罪,她自己也褫了妃位、迁出椒房。那只揪出来的钉子,在乱中又成了金羽的人——这一局,她输得干干净净。',
        },
      ],
    },

    // ══════════ 第四幕《凤仪定鼎》〔大结局〕 ══════════
    act4: {
      id: 'act4',
      bg: 'hall',
      act: '第四幕 · 凤仪定鼎',
      cast: ['quanhuang', 'jinyu'],
      steps: [
        { kind: 'line', who: 'quanhuang', text: '(临朝)中宫之位虚悬已久。六宫无主,终非长法——朕,该立后了。' },
        { kind: 'line', who: 'jinyu', text: '(凤眼赤红,孤注一掷)陛下!立后乃国本,岂容一个心怀叵测之人觊觎!臣妾要奏——她暗害皇嗣、私通宫外,桩桩是诛族的死罪!' },
        { kind: 'branch', flag: 'saved_molan', whenSet: 'a4Ally', whenUnset: 'a4Solo' },
      ],
    },
    a4Ally: {
      id: 'a4Ally',
      bg: 'hall',
      cast: ['molan', 'xuetuan'],
      goto: 'a4threat',
      steps: [
        { kind: 'line', who: 'molan', text: '(挺身出列,毫不退缩)陛下!那一年棠梨宫的巫蛊冤案,臣妾就是活证。金羽构陷成性,今日这通诬告,臣妾愿以性命替妃主作保!' },
      ],
    },
    a4Solo: {
      id: 'a4Solo',
      bg: 'hall',
      cast: ['xuetuan'],
      goto: 'a4threat',
      steps: [
        { kind: 'line', who: 'xuetuan', text: '满殿之上,无一人出列。我等的那个声音,再不会来了——棠梨宫那夜,是我亲手把她送上了断头台。如今金羽的罪要我一张嘴去咬死,身后却空无一人替我兜底。' },
      ],
    },
    a4threat: {
      id: 'a4threat',
      bg: 'hall',
      cast: ['xuetuan'],
      steps: [{ kind: 'branch', flag: 'glory', whenSet: 'a4Glory', whenUnset: 'a4probe' }],
    },
    a4Glory: {
      id: 'a4Glory',
      bg: 'hall',
      cast: ['jinyu', 'xuetuan'],
      goto: 'a4probe',
      steps: [
        { kind: 'line', who: 'xuetuan', text: '(冷眼扫过殿中)当年御宴我锋芒太露,抢尽风头,也把半个后宫推到了金羽那边。此刻她身后乌压压跪倒一片附议的朝臣——当年锋芒夺来的耀眼,如今尽数化作催命的债。这满殿附议的口舌,我得一句话同时压服,半分破绽都露不得。' },
      ],
    },
    a4probe: {
      id: 'a4probe',
      bg: 'hall',
      cast: ['xuetuan', 'quanhuang'],
      steps: [
        { kind: 'line', who: 'xuetuan', text: '诬我害皇嗣,反倒露了她的马脚——真正在皇嗣汤药里动过手脚的,只会是她自己的人。当值的太医、宫人都在这儿了,这一回,我要把她真正的罪,挖到底。' },
        {
          kind: 'deduce',
          prompt: '皇嗣染恙那夜当值的人都在此。嗅出谁在汤药里下了手、谁是金羽伸向龙嗣的那只爪——这是定她生死的铁证。',
          count: 7,
          budget: 2,
          seed: 17,
          onSolve: 'finalShow',
          onFail: 'fengyun',
        },
      ],
    },
    finalShow: {
      id: 'finalShow',
      bg: 'hall',
      cast: ['xuetuan', 'quanhuang'],
      steps: [
        { kind: 'line', who: 'xuetuan', text: '(将供词与药渣高举过顶)铁证在此!害皇嗣的不是别人,正是贵妃金羽,嫁祸于我,以绝立后之路!成败荣枯、这一年的血与泪,都压在我接下来这一句话上了。' },
        {
          kind: 'sayline',
          who: 'quanhuang',
          context: '凤仪大殿,立后在即。雪团手握金羽谋害皇嗣的铁证,要当着犬皇与满朝,把这位权倾后宫的贵妃,一举钉死、扭转乾坤。',
          intent: '当殿定金羽之死罪、为自己正名——以铁证为骨、以家国大义与圣心为刃,一句话翻转满殿风向,既洗清自身诬名,又让犬皇再无回护金羽的余地。',
          onPass: 'a4vouch',
          onFail: 'yusui',
        },
      ],
    },
    a4vouch: {
      id: 'a4vouch',
      bg: 'hall',
      cast: ['xuetuan'],
      steps: [{ kind: 'branch', flag: 'polite', whenSet: 'laofuFinal', whenUnset: 'mercyChoice' }],
    },
    laofuFinal: {
      id: 'laofuFinal',
      bg: 'hall',
      cast: ['laofu', 'quanhuang'],
      goto: 'mercyChoice',
      steps: [
        { kind: 'line', who: 'laofu', text: '(颤巍巍跪下)陛下,老身把了四十年的宫门,什么样的人没见过。这位主子入宫头一日就守礼端方,贵妃却年年构陷、桩桩有迹。老身一把老骨头,愿以性命,为这铁证作保!' },
      ],
    },
    mercyChoice: {
      id: 'mercyChoice',
      bg: 'hall',
      cast: ['jinyu', 'xuetuan'],
      steps: [
        { kind: 'line', who: 'jinyu', text: '(瘫坐于地,凤冠歪斜,再无半分往日气焰)败了……终究是败了。本宫斗了一辈子,输得起。要杀要剐,悉听尊便。(气若游丝)只是——留我?你当真留得起么。' },
        { kind: 'line', who: 'xuetuan', text: '(俯视着她)这一刻我等了整整一年。踏过她,凤位就是我的。可踏下去的这一脚——是了结一段恩怨,还是亲手把自己,也变成她那样的人?' },
        {
          kind: 'choice',
          prompt: '金羽伏地待决,凤位近在眼前。这最后一步,你怎么落?',
          options: [
            { label: '赶尽杀绝,斩草除根永绝后患——只是这一刀下去,你也再不是从前的自己', goto: 'ruthlessBranch' },
            { label: '网开一面,依律论罪、不滥杀——纵知留她一命,他日或成反扑的刀', goto: 'mercyBranch' },
          ],
        },
      ],
    },
    mercyBranch: {
      id: 'mercyBranch',
      bg: 'hall',
      cast: ['xuetuan'],
      steps: [{ kind: 'branch', flag: 'cold_blood', whenSet: 'endLoneJust', whenUnset: 'endPhoenix' }],
    },
    ruthlessBranch: {
      id: 'ruthlessBranch',
      bg: 'hall',
      cast: ['xuetuan'],
      steps: [{ kind: 'branch', flag: 'cold_blood', whenSet: 'endTyrant', whenUnset: 'endBloodRobe' }],
    },
    // ── 大结局 · 四种归宿 + 两处败亡 ──
    endPhoenix: {
      id: 'endPhoenix',
      bg: 'hall',
      cast: ['xuetuan', 'molan'],
      steps: [
        {
          kind: 'ending',
          outcome: 'good',
          text: '【大结局 · 凤仪天下】金羽依律削位、幽于冷宫,一条命留着,照见自己的下场。雪团执掌凤印,母仪天下。册后那日,墨兰扶着她的凤裾,一如当年御花园里递来第一句真心。她没有踏着尸骨登顶,却赢得比谁都干净——这后宫第一次有人记得:她当过别人的伞。〔全剧终 · 最圆满之路〕',
        },
      ],
    },
    endLoneJust: {
      id: 'endLoneJust',
      bg: 'hall',
      cast: ['xuetuan'],
      steps: [
        {
          kind: 'ending',
          outcome: 'good',
          text: '【大结局 · 孤鸾正位】她依律论罪,没有滥杀,守住了为人的底线。凤印在手,六宫俯首。只是册后大典上,那截绣金的凤裾一路拖过冷玉阶,本该有人弯腰替她拈起,却没人去拈——棠梨宫那一夜,她亲手放走了唯一肯弯下腰替她拈裙角的人。坐上了最高处,身边却再没有一个能说真话的人。干净的胜利,孤独的凤座。〔全剧终 · 不负天下,独负一人〕',
        },
      ],
    },
    endBloodRobe: {
      id: 'endBloodRobe',
      bg: 'hall',
      cast: ['xuetuan', 'molan'],
      steps: [
        {
          kind: 'ending',
          outcome: 'good',
          text: '【大结局 · 血染凤袍】一道赐死的旨意,金羽气绝于殿前。雪团踏着她的血,登上了凤位——再没有人敢与她为敌。可那道赐死旨意里的决绝,连墨兰都听出了几分陌生——当年从白绫底下把她夺回来的雪团,与此刻踏血而立的这个,似乎已不是同一个人。她终于成了这后宫最强的人,也成了当年最怕的那种人。凤袍加身,猩红刺目。〔全剧终 · 赢了天下,也染了手〕',
        },
      ],
    },
    endTyrant: {
      id: 'endTyrant',
      bg: 'hall',
      cast: ['xuetuan'],
      steps: [
        {
          kind: 'ending',
          outcome: 'bad',
          text: '【大结局 · 孤家寡人】她赐死了金羽,正如当年弃了墨兰——这一路,挡道的、牵绊的,她一个一个亲手剪除,半分没留。夜深时她常想起入宫那年,那个会为一句真心而心软的雪团,早死在了通往这把椅子的路上。凤位左右,本该列着替她说话的人,如今两侧空着,风一过,珠帘自己响。她终于谁也不必信了——因为再没有一个人,值得她回头看上一眼。〔全剧终 · 登顶之日,即孤绝之时〕',
        },
      ],
    },
    fengyun: {
      id: 'fengyun',
      bg: 'hall',
      cast: ['jinyu', 'xuetuan'],
      steps: [
        {
          kind: 'ending',
          outcome: 'bad',
          text: '【大结局 · 凤陨】最后的铁证,她终究没能寻全。金羽阴恻恻一笑,反手将"暗害皇嗣"的死罪扣得严丝合缝。立后诏书化作了赐死的白绫。一年苦心,万丈高楼,塌在了最后一步。这后宫从不问谁冤——它只记得,凤位上换了人。〔败亡 · 功亏一篑〕',
        },
      ],
    },
    yusui: {
      id: 'yusui',
      bg: 'hall',
      cast: ['jinyu', 'xuetuan'],
      steps: [
        {
          kind: 'ending',
          outcome: 'bad',
          text: '【大结局 · 玉碎】铁证在手,话却没能说到犬皇心里去。金羽抓住那一丝破绽,反咬"伪造罪证、攀诬贵妃、其心可诛"。满殿风向倾覆,雪团百口莫辩。她到底没能跨过最后这道坎——玉碎宫倾,凤位易主。可她挺直了脊背走向殿门,步摇未乱、眉睫未垂——满殿看着她输,却没人看见她折。〔败亡 · 功败垂成〕',
        },
      ],
    },
  },
};
