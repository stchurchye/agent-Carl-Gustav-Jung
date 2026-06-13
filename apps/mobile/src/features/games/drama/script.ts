import type { Script } from './story';

/**
 * 犬朝后宫 · 第一幕(D1 骨架,原创内容;D5 扩写为完整一幕含说台词/查案戏点)。
 * 全部为原创台词与情节,不涉及任何版权作品。
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
            { label: '屈膝行礼,先递上见面礼', setFlags: ['polite'], goto: 'hall' },
            { label: '抬头直言,我是奉旨入宫', goto: 'hall' },
          ],
        },
      ],
    },
    hall: {
      id: 'hall',
      bg: 'hall',
      cast: ['xuetuan'],
      steps: [
        { kind: 'line', who: 'xuetuan', text: '宫门已过,前殿在望。这后宫的水,比想象中深。' },
        { kind: 'ending', outcome: 'good', text: '【第一幕·序】雪团踏入了犬朝后宫。' },
      ],
    },
  },
};
