export type PersonaIdentity = {
  assistantName?: string;
  styleTags?: string;
  emoji?: string;
};

export type PersonaSoul = {
  tone?: string;
  boundaries?: string;
  formatPrefs?: string;
};

export type PersonaUser = {
  preferredName?: string;
  timezone?: string;
  bio?: string;
  habits?: string;
};

export type UserPersonaSettings = {
  schemaVersion?: number;
  identity?: PersonaIdentity;
  soul?: PersonaSoul;
  user?: PersonaUser;
  updatedAt?: string;
};

export type PersonaChannel = 'chat' | 'writing' | 'group';
