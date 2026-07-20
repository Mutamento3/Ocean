export type FreeTimeAction = {
  id?: string;
  label: string;
  enabled: boolean;
  connector?: string;
  description?: string;
};

export type FreeTimeGame = {
  id: string;
  label: string;
  connector?: string;
  icon: "fishing" | "game";
};

export type FreeTimeConfig = {
  paused: boolean;
  minSilenceMinutes: number;
  cooldownMinutes: number;
  activeHours: { start: string; end: string };
  probability: number;
  canDo: FreeTimeAction[];
  games: FreeTimeGame[];
};

export type FreeTimePromptPreview = {
  prompt: string;
  connectorRefs: string[];
  enabledActions: number;
  availableGames: number;
};

export type FreeTimeRun = {
  id: string;
  status: "queued" | "dispatched" | "completed" | "skipped";
  reason?: string;
  prompt?: string;
  connectorRefs?: string[];
  createdAt: string;
  completedAt?: string;
  summary?: string;
  valence?: number;
  arousal?: number;
  action?: string;
  usage?: { providerId: string; modelId: string; inputTokens: number; outputTokens: number; cachedTokens: number; cacheWriteTokens?: number; cost?: number; currency?: string };
};
