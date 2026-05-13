import { Server } from 'socket.io';
import { TikTokLiveConnection } from '@/lib/client';
import { WebcastEvent } from '@/types/events';
import {
  ensureChannel,
  finishLiveSession,
  getViewerThemeState,
  recordGiftAndUnlockThemes,
  resetSessionCounters,
  startLiveSession,
  toGiftPayload,
  upsertThemeRules,
} from './db';
import type {
  ChatEmotePayload,
  ChatPayload,
  FollowPayload,
  GiftPayload,
  LiveStatePayload,
  TestChatInput,
  TestGiftInput,
  ViewerPayload,
} from '../lib/types';

interface ActiveLiveSession {
  channelUniqueId: string;
  channelId: number;
  liveSessionId?: number;
  roomId?: string;
  connection?: TikTokLiveConnection;
}

const DEFAULT_AVATAR = '/legacy/chat/UI_ItemIcon_203.png';

function normalizeTikTokUniqueId(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return '';

  const withoutQuery = trimmed.split(/[?#]/)[0];
  const match = withoutQuery.match(/(?:tiktok\.com\/)?@?([^/\s]+)(?:\/live)?$/i);
  return (match?.[1] || withoutQuery)
    .trim()
    .replace(/^@/, '')
    .replace(/\/live$/i, '')
    .replace(/\//g, '');
}

export class LiveManager {
  private activeByChannel = new Map<string, ActiveLiveSession>();
  private latestState: LiveStatePayload = { state: 'idle' };

  constructor(private readonly io: Server) {}

  getState() {
    return this.latestState;
  }

  async start(channelUniqueId: string) {
    const normalized = normalizeTikTokUniqueId(channelUniqueId);
    if (!normalized) {
      throw new Error('TikTok ID is required');
    }

    const existing = this.activeByChannel.get(normalized);
    if (existing?.connection) {
      return this.publishState({
        state: 'connected',
        channelUniqueId: normalized,
        channelId: existing.channelId,
        roomId: existing.roomId,
      });
    }

    const channel = await ensureChannel(normalized);
    this.publishState({ state: 'connecting', channelUniqueId: normalized, channelId: channel.id });

    const signApiKey = process.env.EULER_API_KEY;
    const connection = new TikTokLiveConnection(normalized, {
      signApiKey,
      enableExtendedGiftInfo: true,
    });

    const session: ActiveLiveSession = {
      channelUniqueId: normalized,
      channelId: channel.id,
      connection,
    };
    this.activeByChannel.set(normalized, session);

    this.attachHandlers(session);

    try {
      const state = await connection.connect();
      session.roomId = String(state.roomId || '');
      session.liveSessionId = await startLiveSession(channel.id, session.roomId);
      await ensureChannel(normalized, session.roomId);
      this.publishState({
        state: 'connected',
        channelUniqueId: normalized,
        channelId: channel.id,
        roomId: session.roomId,
      });
    } catch (error) {
      this.activeByChannel.delete(normalized);
      console.error('Failed to connect TikTok live channel', {
        channelUniqueId: normalized,
        error: error instanceof Error ? error.message : String(error),
      });
      this.publishState({
        state: 'failed',
        channelUniqueId: normalized,
        channelId: channel.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async stop(channelUniqueId?: string) {
    const targets = channelUniqueId
      ? [this.activeByChannel.get(normalizeTikTokUniqueId(channelUniqueId))].filter(Boolean)
      : Array.from(this.activeByChannel.values());

    for (const session of targets) {
      session?.connection?.disconnect();
      await finishLiveSession(session?.liveSessionId);
      if (session) this.activeByChannel.delete(session.channelUniqueId);
    }

    this.publishState({ state: 'stopped' });
  }

  async testGift(input: TestGiftInput = {}) {
    const session = await this.getOrCreateTestSession(input.channelUniqueId);
    const giftDiamonds = Number(input.diamonds || 25);
    const viewer = this.testViewer(input.viewerUniqueId || 'viewer_test_donor', input.nickname || 'Viewer Donor');
    const result = await recordGiftAndUnlockThemes({
      channelId: session.channelId,
      liveSessionId: session.liveSessionId,
      viewer,
      giftDiamonds,
    });

    const payload = toGiftPayload(
      {
        ...viewer,
        giftName: input.giftName || 'Test Gift',
        giftId: 'test-gift',
        repeatCount: Number(input.repeatCount || 1),
        diamondCost: giftDiamonds,
        giftDiamonds,
        channelUniqueId: session.channelUniqueId,
      },
      result.totalDiamonds,
      result.unlockedThemes,
    );

    this.emitGift(payload);
  }

  async testChat(input: TestChatInput = {}) {
    const session = await this.getOrCreateTestSession(input.channelUniqueId);
    const tier = input.tier || 'normal';
    const viewer = this.testViewer(input.viewerUniqueId || `viewer_test_${tier}`, input.nickname || `${tier} viewer`);
    const themes = tier === 'donator' ? ['donator', 'vip'] : tier === 'vip' ? ['vip'] : [];
    const payload: ChatPayload = {
      ...viewer,
      comment: input.comment || `Test ${tier} chat message`,
      themes,
      activeTheme: themes[0],
      donatedDiamonds: tier === 'donator' ? 50 : tier === 'vip' ? 10 : 0,
      canUseDonatorFrame: tier === 'donator',
      channelUniqueId: session.channelUniqueId,
    };

    this.emitChat(payload);
  }

  async testFollow(input: { channelUniqueId?: string } = {}) {
    const session = await this.getOrCreateTestSession(input.channelUniqueId);
    this.emitFollow({
      ...this.testViewer('viewer_test_follow', 'New Follower'),
      channelUniqueId: session.channelUniqueId,
    });
  }

  async resetSessionCounters(channelUniqueId?: string) {
    const target = channelUniqueId ? this.activeByChannel.get(normalizeTikTokUniqueId(channelUniqueId)) : Array.from(this.activeByChannel.values())[0];
    if (!target) return;
    await resetSessionCounters(target.channelId);
    this.io.emit('session:reset', {
      channelUniqueId: target.channelUniqueId,
      channelId: target.channelId,
    });
  }

  async updateSettings(rules: Parameters<typeof upsertThemeRules>[0]) {
    await upsertThemeRules(rules);
    this.io.emit('settings:updated', { rules });
  }

  private attachHandlers(session: ActiveLiveSession) {
    session.connection?.on(WebcastEvent.CHAT, async (data: any) => {
      const viewer = this.viewerFromEvent(data.user);
      const state = await getViewerThemeState({
        channelId: session.channelId,
        liveSessionId: session.liveSessionId,
        viewer,
      });

      const payload: ChatPayload = {
        ...viewer,
        comment: String(data.comment || ''),
        emotes: this.emotesFromChatEvent(data),
        themes: state.themes,
        activeTheme: state.themes[0],
        donatedDiamonds: state.totalDiamonds,
        canUseDonatorFrame: state.themes.includes('donator'),
        channelUniqueId: session.channelUniqueId,
      };
      this.emitChat(payload);
    });

    session.connection?.on(WebcastEvent.EMOTE, async (data: any) => {
      const viewer = this.viewerFromEvent(data.user);
      const state = await getViewerThemeState({
        channelId: session.channelId,
        liveSessionId: session.liveSessionId,
        viewer,
      });
      const emotes = this.emotesFromEmoteEvent(data);
      const payload: ChatPayload = {
        ...viewer,
        comment: emotes.map((emote) => `[${emote.emoteId || 'emote'}]`).join(' '),
        emotes,
        themes: state.themes,
        activeTheme: state.themes[0],
        donatedDiamonds: state.totalDiamonds,
        canUseDonatorFrame: state.themes.includes('donator'),
        channelUniqueId: session.channelUniqueId,
      };

      this.emitChat(payload);
    });

    session.connection?.on(WebcastEvent.GIFT, async (data: any) => {
      const viewer = this.viewerFromEvent(data.user);
      const giftType = data.giftType ?? data.giftDetails?.giftType;
      const repeatEnd = data.repeatEnd === true || data.repeatEnd === 1;
      const shouldCountGift = giftType === 1 ? repeatEnd : true;
      const diamondCost = Number(
        data.giftDetails?.diamondCount ??
          data.extendedGiftInfo?.diamond_count ??
          data.extendedGiftInfo?.diamondCount ??
          0,
      );
      const repeatCount = Number(data.repeatCount || 1);
      const giftDiamonds = shouldCountGift ? diamondCost * repeatCount : 0;

      const result =
        giftDiamonds > 0
          ? await recordGiftAndUnlockThemes({
              channelId: session.channelId,
              liveSessionId: session.liveSessionId,
              viewer,
              giftDiamonds,
            })
          : { totalDiamonds: 0, unlockedThemes: [] };

      this.emitGift(
        toGiftPayload(
          {
            ...viewer,
            giftName: data.giftDetails?.giftName || data.extendedGiftInfo?.name || 'Gift',
            giftId: data.giftId,
            repeatCount,
            diamondCost,
            giftDiamonds,
            channelUniqueId: session.channelUniqueId,
          },
          result.totalDiamonds,
          result.unlockedThemes,
        ),
      );
    });

    session.connection?.on(WebcastEvent.FOLLOW, (data: any) => {
      this.emitFollow({
        ...this.viewerFromEvent(data.user),
        channelUniqueId: session.channelUniqueId,
      });
    });
  }

  private viewerFromEvent(user: any): ViewerPayload {
    const uniqueId = String(user?.uniqueId || user?.userId || 'anonymous');
    return {
      viewerId: String(user?.userId || uniqueId),
      uniqueId,
      nickname: String(user?.nickname || uniqueId),
      profilePictureUrl: user?.profilePicture?.url?.[0] || user?.profilePicture?.urls?.[0] || DEFAULT_AVATAR,
    };
  }

  private emotesFromChatEvent(data: any): ChatEmotePayload[] {
    return Array.isArray(data?.emotes)
      ? data.emotes
          .map((entry: any) => ({
            emoteId: String(entry?.emote?.emoteId || entry?.emoteId || '').trim() || undefined,
            emoteImageUrl: String(entry?.emote?.image?.imageUrl || entry?.emoteImageUrl || '').trim(),
            placeInComment: Number.isFinite(Number(entry?.placeInComment)) ? Number(entry.placeInComment) : undefined,
          }))
          .filter((entry: ChatEmotePayload) => entry.emoteImageUrl)
      : [];
  }

  private emotesFromEmoteEvent(data: any): ChatEmotePayload[] {
    return Array.isArray(data?.emoteList)
      ? data.emoteList
          .map((entry: any) => ({
            emoteId: String(entry?.emoteId || '').trim() || undefined,
            emoteImageUrl: String(entry?.image?.url?.[0] || entry?.image?.imageUrl || '').trim(),
          }))
          .filter((entry: ChatEmotePayload) => entry.emoteImageUrl)
      : [];
  }

  private async getOrCreateTestSession(channelUniqueId?: string): Promise<ActiveLiveSession> {
    const normalized = channelUniqueId ? normalizeTikTokUniqueId(channelUniqueId) : 'test_channel';
    const existing = this.activeByChannel.get(normalized);
    if (existing) return existing;

    const channel = await ensureChannel(normalized, 'test-room');
    const liveSessionId = await startLiveSession(channel.id, 'test-room');
    const session = {
      channelUniqueId: normalized,
      channelId: channel.id,
      liveSessionId,
      roomId: 'test-room',
    };
    this.activeByChannel.set(session.channelUniqueId, session);
    this.publishState({
      state: 'connected',
      channelUniqueId: session.channelUniqueId,
      channelId: session.channelId,
      roomId: session.roomId,
    });
    return session;
  }

  private testViewer(uniqueId: string, nickname: string): ViewerPayload {
    return {
      viewerId: uniqueId,
      uniqueId,
      nickname,
      profilePictureUrl: DEFAULT_AVATAR,
    };
  }

  private emitChat(payload: ChatPayload) {
    this.io.emit('event:chat', payload);
  }

  private emitGift(payload: GiftPayload) {
    this.io.emit('event:gift', payload);
    for (const themeSlug of payload.unlockedThemes) {
      this.io.emit('theme:unlocked', {
        channelUniqueId: payload.channelUniqueId,
        viewerId: payload.viewerId,
        uniqueId: payload.uniqueId,
        themeSlug,
      });
    }
  }

  private emitFollow(payload: FollowPayload) {
    this.io.emit('event:follow', payload);
  }

  private publishState(payload: LiveStatePayload) {
    this.latestState = payload;
    this.io.emit('live:state', payload);
    return payload;
  }
}
