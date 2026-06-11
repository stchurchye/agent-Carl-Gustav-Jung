import { personaAssistantDisplayName } from '@xzz/shared';
import { api } from './api';
import { ASSISTANT_FALLBACK_NAME, DEFAULT_SESSION_TITLE, isDefaultSessionTitle } from './brand';

function truncate(text: string, max = 80): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

function formatSessionTitle(title: string): string {
  const t = title?.trim();
  if (t && !isDefaultSessionTitle(t)) return t;
  return DEFAULT_SESSION_TITLE;
}

async function resolveAssistantName(fallback: string): Promise<string> {
  try {
    const res = await api.getPersona();
    return personaAssistantDisplayName(res.data, fallback);
  } catch {
    return fallback;
  }
}

export type WorkbenchSessionRow = {
  id: string;
  title: string;
  preview: string;
  time?: string;
};

export async function loadWorkbenchSessionRows(
  emptyHint: string,
  assistantFallback = ASSISTANT_FALLBACK_NAME,
): Promise<WorkbenchSessionRow[]> {
  const assistantName = await resolveAssistantName(assistantFallback);
  const sessionsRes = await api.listChatSessions();
  const sessions = [...sessionsRes.data].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return Promise.all(
    sessions.map(async (session) => {
      const msgsRes = await api.getChatMessages(session.id);
      const last = msgsRes.data[msgsRes.data.length - 1];
      let preview = emptyHint;
      let time = session.updatedAt;
      if (last) {
        const body = truncate(last.content || emptyHint);
        preview = last.role === 'user' ? `我：${body}` : `${assistantName}：${body}`;
        time = last.createdAt;
      }
      return {
        id: session.id,
        title: formatSessionTitle(session.title),
        preview,
        time,
      };
    }),
  );
}
