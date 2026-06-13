export type WritingStackParamList = {
  WritingChapters: { documentId: string; documentTitle: string; toast?: string };
  WritingMain: {
    documentId: string;
    chapterId: string;
    chapterTitle?: string;
    toast?: string;
    /** 进入后自动开启识图插入（新建段/文稿后） */
    startOcrFlexible?: boolean;
  };
  DiffPreview: {
    documentId: string;
    revisionId: string;
    blockId: string;
    oldText: string;
    newText: string;
    comment?: string;
    createdAt: string;
    retryAction?: string;
    retryInstruction?: string;
    feedbackHistory?: string[];
    /** 已保持原样：仅查看对比，不可再次采纳 */
    viewOnly?: boolean;
  };
  RevisionHistory: { documentId: string; title: string };
};

export type ApiKeyKindParam = 'deepseek' | 'zenmux' | 'dashscope';

export type BrainStackParamList = {
  BrainHub: undefined;
  BrainPersonalityEdit: undefined;
  SettingsPersonalityIdentity: undefined;
  SettingsPersonalitySoul: undefined;
  SettingsPersonalityUser: undefined;
  BrainMemoryHub: undefined;
  BrainLongMemory: undefined;
  BrainShortMemory: undefined;
  BrainEpisodicMemory: undefined;
  BrainSessionSearch: undefined;
  BrainMemoryReview: undefined;
  BrainHermes: undefined;
  BrainMemoryPrefs: undefined;
  BrainLlmLogs: undefined;
  BrainLlmLogDetail: { id: string };
  BrainMemoryDetail: { fragmentId: string };
  BrainHomeKeys: undefined;
  ApiKeyDetail: { kind: ApiKeyKindParam };
  BrainAgentTasks: undefined;
  BrainAgentTaskDetail: { runId: string };
  /** M1e Task 12: Agent 默认 provider+model 选择 */
  BrainAgentDefaultModel: undefined;
  /** M5-S1: 自蒸馏建议技能评审 */
  BrainSkillReview: undefined;
  SettingsMemory: {
    scope?: 'user' | 'topic' | 'session';
    groupId?: string;
    topicId?: string;
    sessionId?: string;
  };
  /** M6 T2: document ref 跳转 —— BrainStack 也注册以支持 navigateBrainTab 跳转 */
  SettingsDocuments: { scope: 'visible' | 'hidden'; highlightId?: string };
};

export type GroupStackParamList = {
  GroupList: undefined;
  Settings: undefined;
  SettingsProfile: undefined;
  SettingsProfileAvatar: undefined;
  SettingsProfileName: undefined;
  /** 挑狗/挑小人 + 起名(Bow Wow Know) */
  SettingsMyDog: undefined;
  SettingsPersonality: undefined;
  SettingsPersonalityIdentity: undefined;
  SettingsPersonalitySoul: undefined;
  SettingsPersonalityUser: undefined;
  SettingsMemory: {
    scope?: 'user' | 'topic' | 'session';
    groupId?: string;
    topicId?: string;
    sessionId?: string;
  };
  SettingsShortMemory: undefined;
  SettingsMemoryPrefs: undefined;
  SettingsMemorySearch: { sessionId?: string; groupId?: string; topicId?: string };
  SettingsLlmLogs: undefined;
  SettingsLlmLogDetail: { id: string };
  SettingsClientLogs: undefined;
  SettingsDogSound: undefined;
  SettingsVoice: undefined;
  SettingsTopicExport: undefined;
  SettingsDocuments: { scope: 'visible' | 'hidden'; highlightId?: string };
  StudioManage: undefined;
  StudioSearch: undefined;
  /** 小游戏合集(从「我的」进入) */
  GameHub: undefined;
  /** seed 可选:仅测试注入用,正常进入随机开局 */
  GameSleuth: { seed?: number } | undefined;
  GameEscape: undefined;
  /** seed 可选:仅测试注入用 */
  GamePersuade: { seed?: number } | undefined;
  PrivateChat: { sessionId?: string; scrollToMessageId?: string } | undefined;
  GroupTopics: { groupId: string; groupName: string };
  GroupChat: {
    groupId: string;
    groupName: string;
    topicId: string;
    topicName: string;
    scrollToMessageId?: string;
  };
} & WritingStackParamList;
