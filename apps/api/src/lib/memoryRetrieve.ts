import type { MemoryCategory, MemoryLine, MemoryScope } from '@xzz/shared';
import {
  MEMORY_CANDIDATE_POOL_LIMIT,
  MEMORY_PROJECT_NOTE_CHAR_LIMIT,
  MEMORY_SHORT_TERM_CHAR_LIMIT,
  MEMORY_USER_PROFILE_CHAR_LIMIT,
  rankMemoryFragments,
  trimMemoryLines,
} from '@xzz/shared';
import * as intel from '../store/pg-intelligence.js';

function toLine(f: { title: string; content?: string }): MemoryLine | null {
  const content = f.content?.trim();
  if (!content) return null;
  return { title: f.title, content };
}

export type RetrievedMemorySections = {
  userProfile: MemoryLine[];
  projectNotes: MemoryLine[];
  shortTerm: MemoryLine[];
};

export async function retrieveMemoriesForContext(params: {
  userId: string;
  query?: string;
  sessionId?: string | null;
  groupId?: string | null;
  topicId?: string | null;
}): Promise<RetrievedMemorySections> {
  const longFragments = await intel.listMemoryFragments(params.userId, 'user', {
    withContent: true,
    limit: MEMORY_CANDIDATE_POOL_LIMIT,
  });

  let shortScope: MemoryScope | null = null;
  let shortOpts: { groupId?: string; topicId?: string; sessionId?: string } = {};
  if (params.topicId && params.groupId) {
    shortScope = 'topic';
    shortOpts = { groupId: params.groupId, topicId: params.topicId };
  } else if (params.sessionId) {
    shortScope = 'session';
    shortOpts = { sessionId: params.sessionId };
  }

  const shortFragments = shortScope
    ? await intel.listMemoryFragments(params.userId, shortScope, {
        ...shortOpts,
        withContent: true,
        limit: MEMORY_CANDIDATE_POOL_LIMIT,
      })
    : [];

  const rankedLong = rankMemoryFragments(longFragments, params.query);
  const profileLines: MemoryLine[] = [];
  const projectLines: MemoryLine[] = [];

  for (const f of rankedLong) {
    const line = toLine(f);
    if (!line) continue;
    const cat = f.category as MemoryCategory;
    if (cat === 'user_profile') profileLines.push(line);
    else if (cat === 'project_note') projectLines.push(line);
    else {
      projectLines.push(line);
    }
  }

  const rankedShort = rankMemoryFragments(shortFragments, params.query);
  const shortTerm = trimMemoryLines(
    rankedShort.map(toLine).filter((x): x is MemoryLine => x !== null),
    MEMORY_SHORT_TERM_CHAR_LIMIT,
  );

  return {
    userProfile: trimMemoryLines(profileLines, MEMORY_USER_PROFILE_CHAR_LIMIT),
    projectNotes: trimMemoryLines(projectLines, MEMORY_PROJECT_NOTE_CHAR_LIMIT),
    shortTerm,
  };
}
