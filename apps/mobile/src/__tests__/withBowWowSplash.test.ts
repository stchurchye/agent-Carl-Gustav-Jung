import fs from 'fs';
import os from 'os';
import path from 'path';

// config plugin 是构建期 Node 脚本(JS),通过 _test 暴露纯函数。
// 注意:测试只依赖 plugin 自身模板 + 已提交的 assets/splash-logo.png,
// 绝不读 gitignore 的 ios/ 目录,确保 CI(无 prebuild 产物)也能跑。
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { _test } = require('../../plugins/withBowWowSplash') as {
  _test: {
    patchAppDelegate: (s: string) => string;
    writeSplashFiles: (srcRoot: string, srcPng: string) => void;
    SPLASH_STORYBOARD: string;
    IMAGESET_CONTENTS: string;
    CREAM: { r: number; g: number; b: number };
  };
};

const { patchAppDelegate, writeSplashFiles, SPLASH_STORYBOARD } = _test;

// expo SDK54 bare 模板里 AppDelegate 的默认 window/startReactNative 段落。
const DEFAULT_APPDELEGATE = `    bindReactNativeFactory(factory)

#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif

    return super.application(application, didFinishLaunchingWithOptions: launchOptions)`;

describe('withBowWowSplash config plugin', () => {
  describe('patchAppDelegate', () => {
    it('注入奶油底 splashColor + window/根视图染色', () => {
      const out = patchAppDelegate(DEFAULT_APPDELEGATE);
      expect(out).toContain('let splashColor = UIColor(red: 0.957, green: 0.937, blue: 0.894, alpha: 1.0)');
      expect(out).toContain('window?.backgroundColor = splashColor');
      expect(out).toContain('window?.rootViewController?.view.backgroundColor = splashColor');
      // startReactNative 调用必须保留
      expect(out).toContain('factory.startReactNative(');
    });

    it('只产生一处 window 赋值(不重复声明)', () => {
      const out = patchAppDelegate(DEFAULT_APPDELEGATE);
      expect(out.match(/window = UIWindow\(frame: UIScreen\.main\.bounds\)/g)).toHaveLength(1);
    });

    it('幂等:已注入再跑一次内容不变', () => {
      const once = patchAppDelegate(DEFAULT_APPDELEGATE);
      expect(patchAppDelegate(once)).toBe(once);
    });

    it('模板变了匹配不上时原样返回(不抛、不误改)', () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const weird = 'let foo = 1\n// no recognizable window line';
      expect(patchAppDelegate(weird)).toBe(weird);
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });
  });

  describe('storyboard 模板不变量', () => {
    it('内联奶油底 #F4EFE4,不依赖命名色(绕过 launch-screen catalog 解析 bug)', () => {
      expect(SPLASH_STORYBOARD).toContain('red="0.957" green="0.937" blue="0.894"');
      expect(SPLASH_STORYBOARD).not.toContain('name="SplashScreenBackground"');
    });

    it('含 BowWowSplash logo + 「bow wow」/副标题文字', () => {
      expect(SPLASH_STORYBOARD).toContain('image="BowWowSplash"');
      expect(SPLASH_STORYBOARD).toContain('text="bow wow"');
      expect(SPLASH_STORYBOARD).toContain('text="know everything you told"');
    });
  });

  describe('writeSplashFiles', () => {
    let sandbox: string;
    const logoPng = path.resolve(__dirname, '../../assets/splash-logo.png');

    beforeAll(() => {
      sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'bowwow-splash-'));
      writeSplashFiles(sandbox, logoPng);
    });

    afterAll(() => {
      fs.rmSync(sandbox, { recursive: true, force: true });
    });

    it('logo 源文件存在(assets/splash-logo.png 已提交)', () => {
      expect(fs.existsSync(logoPng)).toBe(true);
    });

    it('写出的 storyboard 与模板一致', () => {
      const wrote = fs.readFileSync(path.join(sandbox, 'SplashScreen.storyboard'), 'utf8');
      expect(wrote).toBe(SPLASH_STORYBOARD);
    });

    it('写出 BowWowSplash.imageset 的 Contents.json(三档 scale)', () => {
      const contents = JSON.parse(
        fs.readFileSync(
          path.join(sandbox, 'Images.xcassets/BowWowSplash.imageset/Contents.json'),
          'utf8',
        ),
      );
      expect(contents.images.map((i: { scale: string }) => i.scale)).toEqual(['1x', '2x', '3x']);
    });

    it('三张 imageset PNG 与 splash-logo.png 字节一致', () => {
      const src = fs.readFileSync(logoPng);
      for (const f of ['image.png', 'image@2x.png', 'image@3x.png']) {
        const got = fs.readFileSync(path.join(sandbox, 'Images.xcassets/BowWowSplash.imageset', f));
        expect(got.equals(src)).toBe(true);
      }
    });
  });
});
