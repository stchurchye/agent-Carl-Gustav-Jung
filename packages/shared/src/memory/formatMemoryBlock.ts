export type MemoryLine = { title: string; content: string };

export type MemoryContextSections = {
  userProfile: MemoryLine[];
  projectNotes: MemoryLine[];
  shortTerm: MemoryLine[];
};

export function formatMemoryContextBlock(
  longTerm: MemoryLine[],
  shortTerm: MemoryLine[],
): string {
  return formatMemoryContextSections({
    userProfile: longTerm,
    projectNotes: [],
    shortTerm,
  });
}

/** 分轨注入：【关于你】/【项目与习惯】/【当前会话或话题记忆】 */
export function formatMemoryContextSections(sections: MemoryContextSections): string {
  const parts: string[] = [];

  if (sections.userProfile.length > 0) {
    parts.push(
      '【关于你】',
      ...sections.userProfile.map((m) => `- ${m.title}：${m.content}`),
    );
  }
  if (sections.projectNotes.length > 0) {
    parts.push(
      '【项目与习惯】',
      ...sections.projectNotes.map((m) => `- ${m.title}：${m.content}`),
    );
  }
  if (sections.shortTerm.length > 0) {
    parts.push(
      '【当前会话/话题记忆】',
      ...sections.shortTerm.map((m) => `- ${m.title}：${m.content}`),
    );
  }

  if (parts.length === 0) return '';
  return `${parts.join('\n')}\n\n`;
}
