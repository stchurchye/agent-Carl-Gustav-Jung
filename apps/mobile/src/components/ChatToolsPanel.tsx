import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { ChatSession } from '@xzz/shared';
import { formatRevisionTime } from '@xzz/shared';
import { PrimaryButton } from './PrimaryButton';
import { colors } from '../theme/colors';
import { radius } from '../theme/tokens';
import { useLayout } from '../theme/layout';
import { useTextStyles } from '../theme/useTextStyles';
import { formatSlashCommandsHint } from '@xzz/shared';
import { zh } from '../locales/zh-CN';

const DEFAULT_SESSION_TITLE = '和小助手聊聊';

type Props = {
  sessions: ChatSession[];
  currentSessionId: string | null;
  onNewSession: () => void;
  onSelectSession: (sessionId: string) => void;
  onRenameSession?: (session: ChatSession) => void;
  onReadReply: () => void;
  sending: boolean;
  canReadReply: boolean;
};

function sessionLabel(session: ChatSession): string {
  const title = session.title?.trim();
  if (title && title !== DEFAULT_SESSION_TITLE) return title;
  return DEFAULT_SESSION_TITLE;
}

/** 问答页右侧浮层内的工具区 */
export function ChatToolsPanel({
  sessions,
  currentSessionId,
  onNewSession,
  onSelectSession,
  onRenameSession,
  onReadReply,
  sending,
  canReadReply,
}: Props) {
  const text = useTextStyles();
  const { captionFontSize, bodyLineHeight } = useLayout();
  const pastSessions = sessions.filter((s) => s.id !== currentSessionId);

  return (
    <View style={styles.root}>
      <Text style={[styles.hint, text.body]}>{zh.chat.sideHint}</Text>
      <Text style={[styles.slashTitle, text.caption]}>{zh.chat.slashCommandsTitle}</Text>
      <Text style={[styles.slashBody, { fontSize: captionFontSize, lineHeight: bodyLineHeight }]}>
        {zh.chat.slashCommandsHint}
      </Text>
      <Text style={[styles.slashList, { fontSize: captionFontSize, lineHeight: bodyLineHeight }]}>
        {formatSlashCommandsHint()}
      </Text>
      <PrimaryButton
        title={zh.chat.newSession}
        variant="secondary"
        onPress={onNewSession}
        disabled={sending}
      />

      <Text style={[styles.sectionTitle, text.caption]}>{zh.chat.pastSessionsTitle}</Text>
      <Text style={[styles.renameHint, { fontSize: captionFontSize, lineHeight: bodyLineHeight }]}>
        {zh.chat.pastSessionsRenameHint}
      </Text>
      {pastSessions.length === 0 ? (
        <Text style={[styles.emptyPast, { fontSize: captionFontSize, lineHeight: bodyLineHeight }]}>
          {zh.chat.pastSessionsEmpty}
        </Text>
      ) : (
        <ScrollView
          style={styles.sessionList}
          contentContainerStyle={styles.sessionListContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator
        >
          {pastSessions.map((s) => {
            const time = formatRevisionTime(s.updatedAt);
            return (
              <Pressable
                key={s.id}
                style={({ pressed }) => [styles.sessionRow, pressed && styles.sessionRowPressed]}
                onPress={() => onSelectSession(s.id)}
                onLongPress={onRenameSession ? () => onRenameSession(s) : undefined}
                disabled={sending}
                accessibilityRole="button"
                accessibilityLabel={sessionLabel(s)}
              >
                <Text style={[styles.sessionTitle, text.body]} numberOfLines={2}>
                  {sessionLabel(s)}
                </Text>
                <Text style={[styles.sessionMeta, text.caption]} numberOfLines={1}>
                  {time.full}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      )}

      <PrimaryButton
        title={zh.chat.readReply}
        variant="ghost"
        onPress={onReadReply}
        disabled={!canReadReply}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0, gap: 12, paddingTop: 4 },
  hint: { color: colors.textMuted, flexShrink: 0 },
  slashTitle: {
    color: colors.textMuted,
    fontWeight: '600',
    marginTop: 4,
    flexShrink: 0,
  },
  slashBody: { color: colors.textMuted, flexShrink: 0 },
  slashList: {
    color: colors.textMuted,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    flexShrink: 0,
  },
  sectionTitle: {
    color: colors.textMuted,
    fontWeight: '600',
    marginTop: 4,
    flexShrink: 0,
  },
  renameHint: {
    color: colors.textMuted,
    marginTop: -4,
    marginBottom: 4,
    flexShrink: 0,
  },
  emptyPast: {
    color: colors.textMuted,
    paddingVertical: 8,
    flexShrink: 0,
  },
  sessionList: { flex: 1, minHeight: 80 },
  sessionListContent: { gap: 8, paddingBottom: 8 },
  sessionRow: {
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  sessionRowPressed: { backgroundColor: colors.primarySoft },
  sessionTitle: { fontWeight: '600', marginBottom: 4 },
  sessionMeta: { color: colors.textMuted },
});
