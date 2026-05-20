import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { mermaidInkImageUrl } from '../../lib/mermaidInk';
import { typography } from '../../theme/colors';
import { wechatChat } from '../../theme/wechatChat';
import { SelectableBubbleText } from './SelectableBubbleText';

type Props = {
  code: string;
  onLongPressMenu?: () => void;
};

/** 无需 WebView 原生模块，通过 mermaid.ink 渲染 PNG */
export function MermaidBlock({ code, onLongPressMenu }: Props) {
  const uri = useMemo(() => {
    try {
      return mermaidInkImageUrl(code);
    } catch {
      return null;
    }
  }, [code]);

  const [maxWidth, setMaxWidth] = useState(320);
  const [imgSize, setImgSize] = useState<{ width: number; height: number } | null>(null);
  const [failed, setFailed] = useState(!uri);

  useEffect(() => {
    if (!uri) {
      setFailed(true);
      return;
    }
    setFailed(false);
    setImgSize(null);
    Image.getSize(
      uri,
      (w, h) => {
        if (w <= 0 || h <= 0) {
          setFailed(true);
          return;
        }
        const scale = Math.min(1, maxWidth / w);
        setImgSize({ width: Math.round(w * scale), height: Math.round(h * scale) });
      },
      () => setFailed(true),
    );
  }, [uri, maxWidth]);

  const onLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w > 0 && Math.abs(w - maxWidth) > 2) setMaxWidth(w);
  };

  if (failed) {
    return (
      <View style={styles.wrap}>
        <Text style={styles.label}>mermaid</Text>
        <SelectableBubbleText
          text={code}
          style={styles.fallbackCode}
          onLongPressMenu={onLongPressMenu}
        />
        <Text style={styles.fallbackHint}>图表加载失败，已显示源码</Text>
      </View>
    );
  }

  return (
    <View style={styles.wrap} onLayout={onLayout}>
      {imgSize ? (
        <Pressable
          onLongPress={onLongPressMenu}
          delayLongPress={450}
          disabled={!onLongPressMenu}
        >
          <Image
            source={{ uri: uri! }}
            style={{ width: imgSize.width, height: imgSize.height }}
            resizeMode="contain"
            accessibilityLabel="Mermaid 图表"
            onError={() => setFailed(true)}
          />
        </Pressable>
      ) : (
        <View style={styles.loading}>
          <ActivityIndicator size="small" color="#888" />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginVertical: 4,
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: '#FAFAFA',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#E0E0E0',
    padding: 6,
    alignSelf: 'flex-start',
    maxWidth: '100%',
    flexGrow: 0,
    flexShrink: 1,
  },
  loading: {
    height: 48,
    minWidth: 72,
    alignItems: 'center',
    justifyContent: 'center',
    flexGrow: 0,
  },
  label: {
    fontSize: 10,
    color: wechatChat.senderName,
    marginBottom: 4,
    textTransform: 'lowercase',
  },
  fallbackCode: {
    fontFamily: 'Menlo',
    fontSize: typography.caption,
    lineHeight: 18,
    color: wechatChat.bubbleText,
  },
  fallbackHint: {
    marginTop: 6,
    fontSize: 10,
    color: wechatChat.senderName,
  },
});
