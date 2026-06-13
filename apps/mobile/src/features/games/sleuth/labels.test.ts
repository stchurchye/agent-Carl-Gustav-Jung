import { attrLabel, valueLabel } from './labels';

describe('狗属性中文标签(复用 avatar 编辑器的 map)', () => {
  it('维度名', () => {
    expect(attrLabel('ears')).toBe('耳朵');
    expect(attrLabel('accessoryColor')).toBe('配饰颜色');
  });

  it('取值名(accessoryColor 走 accentNames)', () => {
    expect(valueLabel('ears', 'floppy')).toBe('垂耳');
    expect(valueLabel('coat', 'malt')).toBe('麦芽');
    expect(valueLabel('accessoryColor', 'indigo')).toBe('青蓝');
    expect(valueLabel('personality', 'goofy')).toBe('呆萌');
  });
});
