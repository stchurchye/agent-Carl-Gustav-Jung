import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, typography } from '../theme/colors';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/** 捕获渲染期崩溃，避免整屏纯白 */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[agent-Carl-Gustav-Jung] 界面异常', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <View style={styles.root}>
          <ScrollView contentContainerStyle={styles.content}>
            <Text style={styles.title}>界面出了点问题</Text>
            <Text style={styles.hint}>
              请摇一摇设备打开开发菜单，点 Reload；或确认 Metro（8090）和小助手服务（3922）都在运行。
            </Text>
            <Text style={styles.detail}>{this.state.error.message}</Text>
            <Pressable style={styles.btn} onPress={() => this.setState({ error: null })}>
              <Text style={styles.btnText}>再试一次</Text>
            </Pressable>
          </ScrollView>
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: { flexGrow: 1, justifyContent: 'center', padding: 24, gap: 12 },
  title: { fontSize: typography.title, fontWeight: '700', color: colors.text },
  hint: { fontSize: typography.body, lineHeight: typography.bodyLineHeight, color: colors.text },
  detail: { fontSize: typography.caption, color: colors.textMuted },
  btn: {
    marginTop: 8,
    backgroundColor: colors.primary,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  btnText: { color: colors.onPrimary, fontSize: typography.button, fontWeight: '600' },
});
