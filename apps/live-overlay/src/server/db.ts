import { Pool } from 'pg';
import type { GiftPayload, ThemeRule, UnlockMode, ViewerPayload } from '../lib/types';

let pool: Pool | null = null;

export function getPool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL is required for the live overlay database');
    }

    pool = new Pool({
      connectionString,
      ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
    });
  }

  return pool;
}

export async function checkDatabase() {
  const result = await getPool().query('select 1 as ok');
  return result.rows[0]?.ok === 1;
}

export async function getThemeRules(): Promise<ThemeRule[]> {
  const result = await getPool().query(
    `select theme_slug as "themeSlug",
            threshold_diamonds as "thresholdDiamonds",
            unlock_mode as "unlockMode",
            enabled
       from theme_rules
      order by threshold_diamonds asc, theme_slug asc`,
  );

  return result.rows;
}

export async function upsertThemeRules(rules: ThemeRule[]) {
  const client = await getPool().connect();
  try {
    await client.query('begin');
    for (const rule of rules) {
      await client.query(
        `insert into theme_rules (theme_slug, threshold_diamonds, unlock_mode, enabled)
         values ($1, $2, $3, $4)
         on conflict (theme_slug) do update
            set threshold_diamonds = excluded.threshold_diamonds,
                unlock_mode = excluded.unlock_mode,
                enabled = excluded.enabled,
                updated_at = now()`,
        [rule.themeSlug, rule.thresholdDiamonds, rule.unlockMode, rule.enabled],
      );
    }
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

export async function ensureChannel(uniqueId: string, roomId?: string) {
  const result = await getPool().query(
    `insert into channels (unique_id, display_name, last_room_id)
     values ($1, $1, $2)
     on conflict (unique_id) do update
        set last_room_id = coalesce($2, channels.last_room_id),
            updated_at = now()
     returning id, unique_id as "uniqueId"`,
    [uniqueId, roomId || null],
  );

  return result.rows[0] as { id: number; uniqueId: string };
}

export async function startLiveSession(channelId: number, roomId?: string) {
  const result = await getPool().query(
    `insert into live_sessions (channel_id, room_id, status)
     values ($1, $2, 'active')
     returning id`,
    [channelId, roomId || null],
  );

  await getPool().query(
    `update channel_viewer_stats
        set current_live_diamonds = 0,
            updated_at = now()
      where channel_id = $1`,
    [channelId],
  );

  return result.rows[0].id as number;
}

export async function finishLiveSession(sessionId?: number) {
  if (!sessionId) return;
  await getPool().query(
    `update live_sessions
        set status = 'ended',
            ended_at = now()
      where id = $1`,
    [sessionId],
  );
}

export async function resetSessionCounters(channelId: number) {
  await getPool().query(
    `update channel_viewer_stats
        set current_live_diamonds = 0,
            updated_at = now()
      where channel_id = $1`,
    [channelId],
  );
}

export async function ensureViewer(viewer: ViewerPayload) {
  const result = await getPool().query(
    `insert into viewers (viewer_external_id, unique_id, nickname, avatar_url)
     values ($1, $2, $3, $4)
     on conflict (viewer_external_id) do update
        set unique_id = excluded.unique_id,
            nickname = excluded.nickname,
            avatar_url = excluded.avatar_url,
            updated_at = now()
     returning id`,
    [viewer.viewerId || viewer.uniqueId, viewer.uniqueId, viewer.nickname, viewer.profilePictureUrl || null],
  );

  return result.rows[0].id as number;
}

async function findViewerIdByUniqueId(uniqueId: string) {
  const result = await getPool().query(
    `select id
       from viewers
      where unique_id = $1
      order by id asc
      limit 1`,
    [uniqueId],
  );

  return result.rows[0]?.id as number | undefined;
}

async function ensureManualViewer(uniqueId: string, nickname?: string) {
  const existingViewerId = await findViewerIdByUniqueId(uniqueId);
  if (existingViewerId) {
    await getPool().query(
      `update viewers
          set nickname = case
                when $2::text is null or $2::text = '' then nickname
                else $2
              end,
              updated_at = now()
        where id = $1`,
      [existingViewerId, nickname || null],
    );
    return existingViewerId;
  }

  return ensureViewer({
    viewerId: uniqueId,
    uniqueId,
    nickname: nickname?.trim() || uniqueId,
  });
}

async function mergeChannelViewerDuplicates(channelId: number, uniqueId: string) {
  const duplicateResult = await getPool().query(
    `select v.id,
            coalesce(cvs.lifetime_diamonds, 0) as lifetime_diamonds,
            coalesce(cvs.current_live_diamonds, 0) as current_live_diamonds
       from viewers v
       left join channel_viewer_stats cvs on cvs.viewer_id = v.id and cvs.channel_id = $1
      where v.unique_id = $2
      order by coalesce(cvs.lifetime_diamonds, 0) desc,
               coalesce(cvs.current_live_diamonds, 0) desc,
               v.id asc`,
    [channelId, uniqueId],
  );

  const viewerIds = duplicateResult.rows.map((row) => Number(row.id));
  if (viewerIds.length <= 1) return viewerIds[0];

  const primaryViewerId = viewerIds[0];
  const duplicateViewerIds = viewerIds.slice(1);
  const client = await getPool().connect();
  try {
    await client.query('begin');

    for (const duplicateViewerId of duplicateViewerIds) {
      await client.query(
        `insert into channel_viewer_stats (channel_id, viewer_id, lifetime_diamonds, current_live_diamonds)
         select channel_id, $2, lifetime_diamonds, current_live_diamonds
           from channel_viewer_stats
          where channel_id = $1 and viewer_id = $3
         on conflict (channel_id, viewer_id) do update
            set lifetime_diamonds = channel_viewer_stats.lifetime_diamonds + excluded.lifetime_diamonds,
                current_live_diamonds = channel_viewer_stats.current_live_diamonds + excluded.current_live_diamonds,
                updated_at = now()`,
        [channelId, primaryViewerId, duplicateViewerId],
      );

      await client.query(
        `insert into manual_theme_grants (channel_id, viewer_id, theme_slug, granted_at)
         select channel_id, $2, theme_slug, granted_at
           from manual_theme_grants
          where channel_id = $1 and viewer_id = $3
         on conflict (channel_id, viewer_id, theme_slug) do update
            set granted_at = greatest(manual_theme_grants.granted_at, excluded.granted_at)`,
        [channelId, primaryViewerId, duplicateViewerId],
      );

      await client.query(
        `insert into theme_unlocks
           (channel_id, viewer_id, theme_slug, unlock_mode, live_session_id, scope_key, source_event, unlocked_at)
         select channel_id, $2, theme_slug, unlock_mode, live_session_id, scope_key, source_event, unlocked_at
           from theme_unlocks
          where channel_id = $1 and viewer_id = $3
         on conflict (channel_id, viewer_id, theme_slug, scope_key) do update
            set unlocked_at = greatest(theme_unlocks.unlocked_at, excluded.unlocked_at),
                source_event = theme_unlocks.source_event`,
        [channelId, primaryViewerId, duplicateViewerId],
      );

      await client.query(
        `delete from manual_theme_grants where channel_id = $1 and viewer_id = $2`,
        [channelId, duplicateViewerId],
      );
      await client.query(
        `delete from theme_unlocks where channel_id = $1 and viewer_id = $2`,
        [channelId, duplicateViewerId],
      );
      await client.query(
        `delete from channel_viewer_stats where channel_id = $1 and viewer_id = $2`,
        [channelId, duplicateViewerId],
      );
      await client.query(
        `delete from viewers v
          where v.id = $1
            and not exists (select 1 from channel_viewer_stats cvs where cvs.viewer_id = v.id)
            and not exists (select 1 from theme_unlocks tu where tu.viewer_id = v.id)
            and not exists (select 1 from manual_theme_grants mtg where mtg.viewer_id = v.id)`,
        [duplicateViewerId],
      );
    }

    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }

  return primaryViewerId;
}

export async function recordGiftAndUnlockThemes(input: {
  channelId: number;
  liveSessionId?: number;
  viewer: ViewerPayload;
  giftDiamonds: number;
}): Promise<{ totalDiamonds: number; sessionDiamonds: number; unlockedThemes: string[] }> {
  const viewerId = await ensureViewer(input.viewer);
  const stats = await getPool().query(
    `insert into channel_viewer_stats (channel_id, viewer_id, lifetime_diamonds, current_live_diamonds)
     values ($1, $2, $3, $3)
     on conflict (channel_id, viewer_id) do update
        set lifetime_diamonds = channel_viewer_stats.lifetime_diamonds + excluded.lifetime_diamonds,
            current_live_diamonds = channel_viewer_stats.current_live_diamonds + excluded.current_live_diamonds,
            updated_at = now()
     returning lifetime_diamonds as "totalDiamonds",
               current_live_diamonds as "sessionDiamonds"`,
    [input.channelId, viewerId, input.giftDiamonds],
  );

  const totalDiamonds = Number(stats.rows[0].totalDiamonds || 0);
  const sessionDiamonds = Number(stats.rows[0].sessionDiamonds || 0);
  const rules = await getThemeRules();
  const unlockedThemes: string[] = [];

  for (const rule of rules) {
    if (!rule.enabled) continue;
    const score = rule.unlockMode === 'lifetime' ? totalDiamonds : sessionDiamonds;
    if (score < rule.thresholdDiamonds) continue;

    await upsertThemeUnlock({
      channelId: input.channelId,
      viewerId,
      themeSlug: rule.themeSlug,
      unlockMode: rule.unlockMode,
      liveSessionId: input.liveSessionId,
      sourceEvent: 'gift',
    });
    unlockedThemes.push(rule.themeSlug);
  }

  return { totalDiamonds, sessionDiamonds, unlockedThemes };
}

async function upsertThemeUnlock(input: {
  channelId: number;
  viewerId: number;
  themeSlug: string;
  unlockMode: UnlockMode;
  liveSessionId?: number;
  sourceEvent: string;
}) {
  const scopeKey = input.unlockMode === 'lifetime' ? 'lifetime' : `session:${input.liveSessionId || 'active'}`;
  await getPool().query(
    `insert into theme_unlocks
       (channel_id, viewer_id, theme_slug, unlock_mode, live_session_id, scope_key, source_event)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (channel_id, viewer_id, theme_slug, scope_key) do update
        set unlocked_at = now(),
            source_event = excluded.source_event`,
    [
      input.channelId,
      input.viewerId,
      input.themeSlug,
      input.unlockMode,
      input.liveSessionId || null,
      scopeKey,
      input.sourceEvent,
    ],
  );
}

export async function upsertManualViewerThemes(input: {
  channelUniqueId: string;
  viewerUniqueId: string;
  nickname?: string;
  themeSlugs: string[];
}) {
  const normalizedChannel = input.channelUniqueId.trim().replace(/^@/, '');
  const normalizedViewer = input.viewerUniqueId.trim().replace(/^@/, '');
  if (!normalizedChannel) throw new Error('Channel UID is required');
  if (!normalizedViewer) throw new Error('Viewer UID is required');

  const channel = await ensureChannel(normalizedChannel);
  const viewerId = await mergeChannelViewerDuplicates(
    channel.id,
    normalizedViewer,
  ) || await ensureManualViewer(normalizedViewer, input.nickname);

  await getPool().query(
    `insert into channel_viewer_stats (channel_id, viewer_id, lifetime_diamonds, current_live_diamonds)
     values ($1, $2, 0, 0)
     on conflict (channel_id, viewer_id) do nothing`,
    [channel.id, viewerId],
  );

  const client = await getPool().connect();
  try {
    await client.query('begin');
    await client.query(
      `delete from manual_theme_grants
        where channel_id = $1
          and viewer_id = $2`,
      [channel.id, viewerId],
    );

    for (const themeSlug of Array.from(new Set(input.themeSlugs.map((theme) => theme.trim()).filter(Boolean)))) {
      await client.query(
        `insert into manual_theme_grants (channel_id, viewer_id, theme_slug)
         values ($1, $2, $3)
         on conflict (channel_id, viewer_id, theme_slug) do update
            set granted_at = now()`,
        [channel.id, viewerId, themeSlug],
      );
    }

    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

export async function grantManualViewerThemes(input: {
  channelUniqueId: string;
  viewerUniqueId: string;
  nickname?: string;
  themeSlugs: string[];
}) {
  const normalizedChannel = input.channelUniqueId.trim().replace(/^@/, '');
  const normalizedViewer = input.viewerUniqueId.trim().replace(/^@/, '');
  if (!normalizedChannel) throw new Error('Channel UID is required');
  if (!normalizedViewer) throw new Error('Viewer UID is required');

  const channel = await ensureChannel(normalizedChannel);
  const viewerId = await mergeChannelViewerDuplicates(
    channel.id,
    normalizedViewer,
  ) || await ensureManualViewer(normalizedViewer, input.nickname);

  await getPool().query(
    `insert into channel_viewer_stats (channel_id, viewer_id, lifetime_diamonds, current_live_diamonds)
     values ($1, $2, 0, 0)
     on conflict (channel_id, viewer_id) do nothing`,
    [channel.id, viewerId],
  );

  for (const themeSlug of Array.from(new Set(input.themeSlugs.map((theme) => theme.trim()).filter(Boolean)))) {
    await getPool().query(
      `insert into manual_theme_grants (channel_id, viewer_id, theme_slug)
       values ($1, $2, $3)
       on conflict (channel_id, viewer_id, theme_slug) do update
          set granted_at = now()`,
      [channel.id, viewerId, themeSlug],
    );
  }
}

export async function deleteManualViewerThemes(input: {
  channelUniqueId: string;
  viewerUniqueId: string;
}) {
  const normalizedChannel = input.channelUniqueId.trim().replace(/^@/, '');
  const normalizedViewer = input.viewerUniqueId.trim().replace(/^@/, '');
  const channel = await ensureChannel(normalizedChannel);
  await mergeChannelViewerDuplicates(channel.id, normalizedViewer);

  const result = await getPool().query(
    `with target_viewers as (
       select id from viewers where unique_id = $2
     ),
     deleted_manual as (
       delete from manual_theme_grants mtg
        using target_viewers tv
        where mtg.channel_id = $1
          and mtg.viewer_id = tv.id
       returning mtg.viewer_id
     ),
     deleted_stats as (
       delete from channel_viewer_stats cvs
        using target_viewers tv
        where cvs.channel_id = $1
          and cvs.viewer_id = tv.id
          and cvs.lifetime_diamonds = 0
          and cvs.current_live_diamonds = 0
          and not exists (
            select 1 from theme_unlocks tu
             where tu.channel_id = cvs.channel_id
               and tu.viewer_id = cvs.viewer_id
          )
          and not exists (
            select 1 from manual_theme_grants mtg
             where mtg.channel_id = cvs.channel_id
               and mtg.viewer_id = cvs.viewer_id
          )
       returning cvs.viewer_id
     )
     select
       (select count(*) from deleted_manual) as "deletedManual",
       (select count(*) from deleted_stats) as "deletedStats"`,
    [channel.id, normalizedViewer],
  );

  await getPool().query(
    `delete from viewers v
      where v.unique_id = $1
        and not exists (select 1 from channel_viewer_stats cvs where cvs.viewer_id = v.id)
        and not exists (select 1 from theme_unlocks tu where tu.viewer_id = v.id)
        and not exists (select 1 from manual_theme_grants mtg where mtg.viewer_id = v.id)`,
    [normalizedViewer],
  );

  return Number(result.rows[0]?.deletedManual || 0) + Number(result.rows[0]?.deletedStats || 0);
}

export async function getViewerThemeState(input: {
  channelId: number;
  liveSessionId?: number;
  viewer: ViewerPayload;
}) {
  const viewerId = await ensureViewer(input.viewer);
  const sessionScope = `session:${input.liveSessionId || 'active'}`;
  const result = await getPool().query(
    `with unlocked as (
         select theme_slug, unlocked_at as sort_at
           from theme_unlocks
          where channel_id = $1
            and viewer_id = $2
            and (scope_key = 'lifetime' or scope_key = $3)
         union
         select theme_slug, granted_at as sort_at
           from manual_theme_grants
          where channel_id = $1
            and viewer_id = $2
       )
     select theme_slug as "themeSlug"
       from unlocked
      group by theme_slug
      order by max(sort_at) desc`,
    [input.channelId, viewerId, sessionScope],
  );

  const stats = await getPool().query(
    `select lifetime_diamonds as "totalDiamonds",
            current_live_diamonds as "sessionDiamonds"
       from channel_viewer_stats
      where channel_id = $1 and viewer_id = $2`,
    [input.channelId, viewerId],
  );

  return {
    themes: result.rows.map((row) => row.themeSlug as string),
    totalDiamonds: Number(stats.rows[0]?.totalDiamonds || 0),
    sessionDiamonds: Number(stats.rows[0]?.sessionDiamonds || 0),
  };
}

export async function listViewers(channelId?: number) {
  if (channelId) {
    const duplicateResult = await getPool().query(
      `select v.unique_id
         from channel_viewer_stats cvs
         join viewers v on v.id = cvs.viewer_id
        where cvs.channel_id = $1
        group by v.unique_id
       having count(*) > 1`,
      [channelId],
    );

    for (const row of duplicateResult.rows) {
      await mergeChannelViewerDuplicates(channelId, row.unique_id);
    }
  }

  const params: unknown[] = [];
  const where = channelId ? 'where cvs.channel_id = $1' : '';
  if (channelId) params.push(channelId);

  const result = await getPool().query(
    `select c.unique_id as "channelUniqueId",
            v.viewer_external_id as "viewerId",
            v.unique_id as "uniqueId",
            v.nickname,
            cvs.lifetime_diamonds as "lifetimeDiamonds",
            cvs.current_live_diamonds as "currentLiveDiamonds",
            array(
              select distinct theme_slug
                from unnest(
                  coalesce(array_agg(distinct tu.theme_slug) filter (where tu.theme_slug is not null), '{}') ||
                  coalesce(array_agg(distinct mtg.theme_slug) filter (where mtg.theme_slug is not null), '{}')
                ) theme_slug
               order by theme_slug
            ) as themes,
            coalesce(array_agg(distinct mtg.theme_slug) filter (where mtg.theme_slug is not null), '{}') as "manualThemes"
       from channel_viewer_stats cvs
       join channels c on c.id = cvs.channel_id
       join viewers v on v.id = cvs.viewer_id
       left join theme_unlocks tu on tu.channel_id = cvs.channel_id and tu.viewer_id = cvs.viewer_id
       left join manual_theme_grants mtg on mtg.channel_id = cvs.channel_id and mtg.viewer_id = cvs.viewer_id
       ${where}
      group by c.unique_id, v.viewer_external_id, v.unique_id, v.nickname, cvs.lifetime_diamonds, cvs.current_live_diamonds
      order by cvs.lifetime_diamonds desc
      limit 100`,
    params,
  );

  return result.rows;
}

export function toGiftPayload(base: Omit<GiftPayload, 'unlockedThemes' | 'totalDiamonds'>, totalDiamonds: number, unlockedThemes: string[]): GiftPayload {
  return {
    ...base,
    totalDiamonds,
    unlockedThemes,
  };
}
