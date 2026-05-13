export type UnlockMode = 'lifetime' | 'session';
export type LiveState = 'idle' | 'connecting' | 'connected' | 'failed' | 'stopped';
export type ThemeTier = 'normal' | 'vip' | 'donator';

export interface ThemeRule {
  themeSlug: string;
  thresholdDiamonds: number;
  unlockMode: UnlockMode;
  enabled: boolean;
}

export interface LiveStatePayload {
  state: LiveState;
  channelUniqueId?: string;
  channelId?: number;
  roomId?: string;
  error?: string;
}

export interface ViewerPayload {
  viewerId?: string;
  uniqueId: string;
  nickname: string;
  profilePictureUrl?: string;
}

export interface ChatEmotePayload {
  emoteId?: string;
  emoteImageUrl: string;
  placeInComment?: number;
}

export interface ChatPayload extends ViewerPayload {
  comment: string;
  emotes?: ChatEmotePayload[];
  themes: string[];
  activeTheme?: string;
  donatedDiamonds: number;
  canUseDonatorFrame: boolean;
  channelUniqueId?: string;
}

export interface GiftPayload extends ViewerPayload {
  giftName: string;
  giftId?: string | number;
  repeatCount: number;
  diamondCost: number;
  giftDiamonds: number;
  totalDiamonds: number;
  unlockedThemes: string[];
  channelUniqueId?: string;
}

export interface FollowPayload extends ViewerPayload {
  channelUniqueId?: string;
}

export interface TestChatInput {
  tier?: ThemeTier;
  comment?: string;
  viewerUniqueId?: string;
  nickname?: string;
  channelUniqueId?: string;
}

export interface TestGiftInput {
  diamonds?: number;
  repeatCount?: number;
  viewerUniqueId?: string;
  nickname?: string;
  giftName?: string;
  channelUniqueId?: string;
}
