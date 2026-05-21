import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import WebView from 'react-native-webview';

type Props = {
  mermaid: string;
  title?: string;
};

/**
 * M2 Task 5B: Render a Mermaid diagram inline.
 *
 * Strategy: WebView with mermaid loaded from CDN (jsDelivr). This avoids
 * shipping ~2MB of mermaid JS in the bundle. On WebView failure (no network,
 * CDN down), fallback to a scrollable code block showing the raw mermaid source.
 */
export default function DiagramMessage({ mermaid, title }: Props) {
  const [failed, setFailed] = useState(false);

  const html = useMemo(() => {
    const escaped = mermaid
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    return `<!doctype html>
<html><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  body { margin: 0; padding: 12px; background: #fff; font-family: -apple-system, sans-serif; }
  .mermaid { text-align: center; }
</style>
</head><body>
<pre class="mermaid">${escaped}</pre>
<script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
<script>
  try {
    mermaid.initialize({ startOnLoad: true, theme: 'default', securityLevel: 'strict' });
  } catch (e) {
    document.body.innerHTML = '<p style="color:red">mermaid 渲染失败：' + e.message + '</p>';
  }
</script>
</body></html>`;
  }, [mermaid]);

  if (failed) {
    return (
      <View style={styles.fallback}>
        {title ? (
          <Text style={styles.title}>{title}（渲染失败，展示源码）</Text>
        ) : null}
        <ScrollView horizontal style={styles.scroller}>
          <Text style={styles.code}>{mermaid}</Text>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {title ? <Text style={styles.title}>{title}</Text> : null}
      <WebView
        originWhitelist={['*']}
        source={{ html }}
        style={styles.webview}
        scalesPageToFit
        javaScriptEnabled
        onError={() => setFailed(true)}
        onHttpError={() => setFailed(true)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    minHeight: 240,
    backgroundColor: '#fff',
    borderRadius: 8,
    overflow: 'hidden',
  },
  title: {
    fontSize: 14,
    fontWeight: '600',
    padding: 8,
    color: '#333',
  },
  webview: {
    flex: 1,
    minHeight: 200,
  },
  fallback: {
    padding: 12,
    backgroundColor: '#f7f7f7',
    borderRadius: 8,
  },
  scroller: {
    maxHeight: 200,
  },
  code: {
    fontFamily: 'Menlo',
    fontSize: 12,
    color: '#444',
  },
});
