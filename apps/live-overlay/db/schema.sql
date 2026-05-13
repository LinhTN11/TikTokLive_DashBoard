create table if not exists channels (
  id bigserial primary key,
  unique_id text not null unique,
  display_name text not null,
  last_room_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists viewers (
  id bigserial primary key,
  viewer_external_id text not null unique,
  unique_id text not null,
  nickname text not null,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists live_sessions (
  id bigserial primary key,
  channel_id bigint not null references channels(id) on delete cascade,
  room_id text,
  status text not null default 'active',
  started_at timestamptz not null default now(),
  ended_at timestamptz
);

create table if not exists channel_viewer_stats (
  channel_id bigint not null references channels(id) on delete cascade,
  viewer_id bigint not null references viewers(id) on delete cascade,
  lifetime_diamonds bigint not null default 0,
  current_live_diamonds bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (channel_id, viewer_id)
);

create table if not exists theme_rules (
  theme_slug text primary key,
  threshold_diamonds integer not null default 0,
  unlock_mode text not null check (unlock_mode in ('lifetime', 'session')),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists theme_unlocks (
  id bigserial primary key,
  channel_id bigint not null references channels(id) on delete cascade,
  viewer_id bigint not null references viewers(id) on delete cascade,
  theme_slug text not null references theme_rules(theme_slug) on delete cascade,
  unlock_mode text not null check (unlock_mode in ('lifetime', 'session')),
  live_session_id bigint references live_sessions(id) on delete set null,
  scope_key text not null,
  source_event text not null,
  unlocked_at timestamptz not null default now(),
  unique (channel_id, viewer_id, theme_slug, scope_key)
);

create index if not exists theme_unlocks_viewer_idx
  on theme_unlocks (channel_id, viewer_id, unlocked_at desc);

create table if not exists manual_theme_grants (
  channel_id bigint not null references channels(id) on delete cascade,
  viewer_id bigint not null references viewers(id) on delete cascade,
  theme_slug text not null references theme_rules(theme_slug) on delete cascade,
  granted_at timestamptz not null default now(),
  primary key (channel_id, viewer_id, theme_slug)
);

create index if not exists manual_theme_grants_viewer_idx
  on manual_theme_grants (channel_id, viewer_id, granted_at desc);

insert into theme_rules (theme_slug, threshold_diamonds, unlock_mode, enabled)
values
  ('vip', 10, 'lifetime', true),
  ('donator', 50, 'lifetime', true)
on conflict (theme_slug) do nothing;
