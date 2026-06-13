// @ts-check
/**
 * Bow Wow 启动屏 config plugin。
 *
 * 背景:原生 splash 由「手改的 ios 原生文件」承载(storyboard 文字 + 内联奶油底 +
 * BowWowSplash 图 + AppDelegate window 染色),但这些文件都被 gitignore。一旦有人
 * 跑 `expo prebuild`,生成器会用默认模板覆盖它们,启动屏就回退成白屏 + 无文字。
 *
 * 这个 plugin 在 prebuild 末尾(dangerousMod / withAppDelegate)把验证过的状态重新写回:
 *   1. SplashScreen.storyboard —— 内联奶油底 #F4EFE4 + 居中 logo(-44) + 「bow wow」/副标题
 *   2. BowWowSplash.imageset   —— 从 assets/splash-logo.png(= launcher icon,底已重映射成奶油)
 *   3. AppDelegate.swift       —— window/根视图染奶油色,消除 native splash → JS 首帧白闪
 *
 * 全部幂等:已注入则跳过;模板变了匹配不上会 warn 而非静默失败。
 * 单一来源:奶油色 / logo 文件名 / 位置都集中在本文件顶部常量,改一处即可。
 */
const { withDangerousMod, withAppDelegate, IOSConfig } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

// —— 单一来源常量 ——
const CREAM = { r: 0.957, g: 0.937, b: 0.894 }; // #F4EFE4,与 BootSplash.tsx / app.json 同色
const LOGO_ASSET = 'assets/splash-logo.png'; // 相对 projectRoot;= icon.png 但底重映射成奶油
const LOGO_PT = 120;
const LOGO_CENTER_Y_OFFSET = -44;

const SPLASH_STORYBOARD = `<?xml version="1.0" encoding="UTF-8"?>
<document type="com.apple.InterfaceBuilder3.CocoaTouch.Storyboard.XIB" version="3.0" toolsVersion="24093.7" targetRuntime="iOS.CocoaTouch" propertyAccessControl="none" useAutolayout="YES" launchScreen="YES" useTraitCollections="YES" useSafeAreas="YES" colorMatched="YES" initialViewController="EXPO-VIEWCONTROLLER-1">
    <device id="retina6_12" orientation="portrait" appearance="light"/>
    <dependencies>
        <deployment identifier="iOS"/>
        <plugIn identifier="com.apple.InterfaceBuilder.IBCocoaTouchPlugin" version="24053.1"/>
        <capability name="Named colors" minToolsVersion="9.0"/>
        <capability name="Safe area layout guides" minToolsVersion="9.0"/>
        <capability name="System colors in document resources" minToolsVersion="11.0"/>
        <capability name="documents saved in the Xcode 8 format" minToolsVersion="8.0"/>
    </dependencies>
    <scenes>
        <scene sceneID="EXPO-SCENE-1">
            <objects>
                <viewController storyboardIdentifier="SplashScreenViewController" id="EXPO-VIEWCONTROLLER-1" sceneMemberID="viewController">
                    <view key="view" userInteractionEnabled="NO" contentMode="scaleToFill" insetsLayoutMarginsFromSafeArea="NO" id="EXPO-ContainerView" userLabel="ContainerView">
                        <rect key="frame" x="0.0" y="0.0" width="393" height="852"/>
                        <autoresizingMask key="autoresizingMask" flexibleMaxX="YES" flexibleMaxY="YES"/>
                        <subviews>
                            <imageView clipsSubviews="YES" userInteractionEnabled="NO" contentMode="scaleAspectFit" image="BowWowSplash" translatesAutoresizingMaskIntoConstraints="NO" id="EXPO-SplashScreenLogo">
                                <rect key="frame" x="136.5" y="316" width="${LOGO_PT}" height="${LOGO_PT}"/>
                            </imageView>
                            <label opaque="NO" userInteractionEnabled="NO" contentMode="left" horizontalHuggingPriority="251" verticalHuggingPriority="251" text="bow wow" textAlignment="center" lineBreakMode="tailTruncation" baselineAdjustment="alignBaselines" adjustsFontSizeToFit="NO" translatesAutoresizingMaskIntoConstraints="NO" id="EXPO-SplashAppName">
                                <rect key="frame" x="146" y="460" width="101" height="38"/>
                                <fontDescription key="fontDescription" type="boldSystem" pointSize="32"/>
                                <color key="textColor" red="0.756862745" green="0.37254902" blue="0.235294118" alpha="1" colorSpace="custom" customColorSpace="sRGB"/>
                                <nil key="highlightedColor"/>
                            </label>
                            <label opaque="NO" userInteractionEnabled="NO" contentMode="left" horizontalHuggingPriority="251" verticalHuggingPriority="251" text="know everything you told" textAlignment="center" lineBreakMode="tailTruncation" baselineAdjustment="alignBaselines" adjustsFontSizeToFit="NO" translatesAutoresizingMaskIntoConstraints="NO" id="EXPO-SplashTagline">
                                <rect key="frame" x="118" y="506" width="157" height="18"/>
                                <fontDescription key="fontDescription" type="system" pointSize="14"/>
                                <color key="textColor" red="0.541176471" green="0.501960784" blue="0.439215686" alpha="1" colorSpace="custom" customColorSpace="sRGB"/>
                                <nil key="highlightedColor"/>
                            </label>
                        </subviews>
                        <viewLayoutGuide key="safeArea" id="Rmq-lb-GrQ"/>
                        <constraints>
                            <constraint firstItem="EXPO-SplashAppName" firstAttribute="centerX" secondItem="EXPO-ContainerView" secondAttribute="centerX" id="EXPO-NameCenterX"/>
                            <constraint firstItem="EXPO-SplashScreenLogo" firstAttribute="centerX" secondItem="EXPO-ContainerView" secondAttribute="centerX" id="EXPO-LogoCenterX"/>
                            <constraint firstItem="EXPO-SplashScreenLogo" firstAttribute="centerY" secondItem="EXPO-ContainerView" secondAttribute="centerY" constant="${LOGO_CENTER_Y_OFFSET}" id="EXPO-LogoCenterY"/>
                            <constraint firstItem="EXPO-SplashScreenLogo" firstAttribute="width" constant="${LOGO_PT}" id="EXPO-LogoWidth"/>
                            <constraint firstItem="EXPO-SplashScreenLogo" firstAttribute="height" constant="${LOGO_PT}" id="EXPO-LogoHeight"/>
                            <constraint firstItem="EXPO-SplashAppName" firstAttribute="top" secondItem="EXPO-SplashScreenLogo" secondAttribute="bottom" constant="24" id="EXPO-NameBelowLogo"/>
                            <constraint firstItem="EXPO-SplashTagline" firstAttribute="centerX" secondItem="EXPO-ContainerView" secondAttribute="centerX" id="EXPO-TaglineCenterX"/>
                            <constraint firstItem="EXPO-SplashTagline" firstAttribute="top" secondItem="EXPO-SplashAppName" secondAttribute="bottom" constant="8" id="EXPO-TaglineBelowName"/>
                        </constraints>
                        <color key="backgroundColor" red="${CREAM.r}" green="${CREAM.g}" blue="${CREAM.b}" alpha="1" colorSpace="custom" customColorSpace="sRGB"/>
                    </view>
                </viewController>
                <placeholder placeholderIdentifier="IBFirstResponder" id="EXPO-PLACEHOLDER-1" userLabel="First Responder" sceneMemberID="firstResponder"/>
            </objects>
            <point key="canvasLocation" x="0.0" y="0.0"/>
        </scene>
    </scenes>
    <resources>
        <image name="BowWowSplash" width="1024" height="1024"/>
    </resources>
</document>
`;

const IMAGESET_CONTENTS = JSON.stringify(
  {
    images: [
      { idiom: 'universal', filename: 'image.png', scale: '1x' },
      { idiom: 'universal', filename: 'image@2x.png', scale: '2x' },
      { idiom: 'universal', filename: 'image@3x.png', scale: '3x' },
    ],
    info: { version: 1, author: 'expo' },
  },
  null,
  2,
);

/**
 * 找到 ios app 源码目录(含 AppDelegate.swift 的那个),失败再退回 projectName 拼接。
 * @param {any} config dangerousMod 回调里的 config(带 modRequest)
 * @returns {string}
 */
function resolveIosSourceRoot(config) {
  const { projectRoot, platformProjectRoot, projectName } = config.modRequest;
  try {
    const root = IOSConfig.Paths.getSourceRoot(projectRoot);
    if (root && fs.existsSync(root)) return root;
  } catch {
    /* fall through */
  }
  return path.join(platformProjectRoot, projectName);
}

/**
 * storyboard + BowWowSplash.imageset 的实际落盘逻辑(纯文件操作,便于单测)。
 * @param {string} srcRoot ios app 源码目录
 * @param {string} srcPng assets/splash-logo.png 的绝对路径
 */
function writeSplashFiles(srcRoot, srcPng) {
  fs.writeFileSync(path.join(srcRoot, 'SplashScreen.storyboard'), SPLASH_STORYBOARD);
  const imgDir = path.join(srcRoot, 'Images.xcassets', 'BowWowSplash.imageset');
  fs.mkdirSync(imgDir, { recursive: true });
  fs.writeFileSync(path.join(imgDir, 'Contents.json'), IMAGESET_CONTENTS);
  if (!fs.existsSync(srcPng)) {
    throw new Error(
      `[withBowWowSplash] 找不到 logo 源文件 ${srcPng},无法生成 BowWowSplash.imageset`,
    );
  }
  for (const f of ['image.png', 'image@2x.png', 'image@3x.png']) {
    fs.copyFileSync(srcPng, path.join(imgDir, f));
  }
}

/**
 * 1+2:写 storyboard + BowWowSplash.imageset。
 * @param {any} config
 * @returns {any}
 */
function withBowWowSplashFiles(config) {
  return withDangerousMod(config, [
    'ios',
    (cfg) => {
      const srcRoot = resolveIosSourceRoot(cfg);
      const srcPng = path.join(cfg.modRequest.projectRoot, LOGO_ASSET);
      writeSplashFiles(srcRoot, srcPng);
      return cfg;
    },
  ]);
}

/**
 * 把默认 AppDelegate 的 window/startReactNative 段落替换成染奶油底的版本(幂等)。
 * @param {string} contents AppDelegate.swift 源码
 * @returns {string}
 */
function patchAppDelegate(contents) {
  if (contents.includes('splashColor')) return contents; // 已注入
  const re =
    /window = UIWindow\(frame: UIScreen\.main\.bounds\)\s*\n\s*factory\.startReactNative\(\s*\n\s*withModuleName:\s*"main",\s*\n\s*in:\s*window,\s*\n\s*launchOptions:\s*launchOptions\)/;
  if (!re.test(contents)) {
    console.warn(
      '[withBowWowSplash] AppDelegate 模板已变,未能注入 splash 底色;请手动核对 window.backgroundColor。',
    );
    return contents;
  }
  const block = [
    '// 与 native splash 同色 (#F4EFE4),消除 native splash → JS 首帧之间的白屏闪烁。',
    `    let splashColor = UIColor(red: ${CREAM.r}, green: ${CREAM.g}, blue: ${CREAM.b}, alpha: 1.0)`,
    '    window = UIWindow(frame: UIScreen.main.bounds)',
    '    window?.backgroundColor = splashColor',
    '    factory.startReactNative(',
    '      withModuleName: "main",',
    '      in: window,',
    '      launchOptions: launchOptions)',
    '    // JS 加载期间盖在最上面的是 RN 根视图(默认白底、不透明),会挡住 window 背景;',
    '    // 必须把根视图控制器的 view 也染成同色,间隙才不再露白。',
    '    window?.rootViewController?.view.backgroundColor = splashColor',
  ].join('\n');
  return contents.replace(re, block);
}

/**
 * 3:AppDelegate window 染色。
 * @param {any} config
 * @returns {any}
 */
function withBowWowSplashAppDelegate(config) {
  return withAppDelegate(config, (cfg) => {
    if (cfg.modResults.language !== 'swift') {
      console.warn('[withBowWowSplash] AppDelegate 不是 Swift,跳过 splash 底色注入。');
      return cfg;
    }
    cfg.modResults.contents = patchAppDelegate(cfg.modResults.contents);
    return cfg;
  });
}

/**
 * @param {any} config Expo 配置对象
 * @returns {any}
 */
function withBowWowSplash(config) {
  return withBowWowSplashAppDelegate(withBowWowSplashFiles(config));
}

module.exports = withBowWowSplash;
// 仅供单测:暴露纯函数与模板,不影响 plugin 公共契约。
module.exports._test = { patchAppDelegate, writeSplashFiles, SPLASH_STORYBOARD, IMAGESET_CONTENTS, CREAM };
