'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { ChatPayload, FollowPayload, GiftPayload, LiveStatePayload, ThemeRule, ThemeTier } from '../lib/types';
import { getSocket } from '../lib/socket-client';

type Activity =
  | { type: 'chat'; payload: ChatPayload }
  | { type: 'gift'; payload: GiftPayload }
  | { type: 'follow'; payload: FollowPayload }
  | { type: 'unlock'; payload: { channelUniqueId?: string; uniqueId: string; themeSlug: string } };

interface SavedViewer {
  channelUniqueId: string;
  viewerId: string;
  uniqueId: string;
  nickname: string;
  lifetimeDiamonds: number;
  currentLiveDiamonds: number;
  themes: string[];
  manualThemes: string[];
}

const defaultRules: ThemeRule[] = [
  { themeSlug: 'vip', thresholdDiamonds: 10, unlockMode: 'lifetime', enabled: true },
  { themeSlug: 'donator', thresholdDiamonds: 50, unlockMode: 'lifetime', enabled: true },
];

const overlayLinks = [
  { label: 'Gift', path: 'gift', tone: 'gift' },
  { label: 'Follow', path: 'follow', tone: 'follow' },
  { label: 'Chat', path: 'chat', tone: 'chat' },
  { label: 'Donator', path: 'chat/donator', tone: 'donator' },
];

function normalizeChannelUid(value?: string) {
  const trimmed = (value || '').trim();
  if (!trimmed) return '';

  const withoutQuery = trimmed.split(/[?#]/)[0];
  const match = withoutQuery.match(/(?:tiktok\.com\/)?@?([^/\s]+)(?:\/live)?$/i);
  return (match?.[1] || withoutQuery)
    .trim()
    .replace(/^@/, '')
    .replace(/\/live$/i, '')
    .replace(/\//g, '');
}

export function Dashboard() {
  const [uniqueId, setUniqueId] = useState('');
  const [state, setState] = useState<LiveStatePayload>({ state: 'idle' });
  const [rules, setRules] = useState<ThemeRule[]>(defaultRules);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [viewers, setViewers] = useState<SavedViewer[]>([]);
  const [viewersVersion, setViewersVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const socket = useMemo(() => getSocket(), []);
  const dashboardChannel = normalizeChannelUid(uniqueId) || normalizeChannelUid(state.channelUniqueId);

  useEffect(() => {
    fetch('/api/settings')
      .then((response) => response.json())
      .then((payload) => {
        if (payload.rules?.length) setRules(payload.rules);
      })
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    const channelQuery = state.channelId ? `?channelId=${state.channelId}` : '';
    fetch(`/api/viewers${channelQuery}`)
      .then((response) => response.json())
      .then((payload) => setViewers(payload.viewers || []))
      .catch(() => undefined);
  }, [state.channelId, activity.length, viewersVersion]);

  useEffect(() => {
    setActivity([]);
  }, [dashboardChannel]);

  useEffect(() => {
    const isDashboardChannel = (payloadChannel?: string) => {
      if (!dashboardChannel) return false;
      return normalizeChannelUid(payloadChannel) === dashboardChannel;
    };

    const onState = (payload: LiveStatePayload) => setState(payload);
    const onChat = (payload: ChatPayload) => {
      if (isDashboardChannel(payload.channelUniqueId)) {
        pushActivity({ type: 'chat', payload });
        setViewersVersion((current) => current + 1);
      }
    };
    const onGift = (payload: GiftPayload) => {
      if (isDashboardChannel(payload.channelUniqueId)) {
        pushActivity({ type: 'gift', payload });
        setViewersVersion((current) => current + 1);
      }
    };
    const onFollow = (payload: FollowPayload) => {
      if (isDashboardChannel(payload.channelUniqueId)) {
        pushActivity({ type: 'follow', payload });
        setViewersVersion((current) => current + 1);
      }
    };
    const onUnlock = (payload: { channelUniqueId?: string; uniqueId: string; themeSlug: string }) => {
      if (isDashboardChannel(payload.channelUniqueId)) {
        pushActivity({ type: 'unlock', payload });
        setViewersVersion((current) => current + 1);
      }
    };

    socket.on('live:state', onState);
    socket.on('event:chat', onChat);
    socket.on('event:gift', onGift);
    socket.on('event:follow', onFollow);
    socket.on('theme:unlocked', onUnlock);

    return () => {
      socket.off('live:state', onState);
      socket.off('event:chat', onChat);
      socket.off('event:gift', onGift);
      socket.off('event:follow', onFollow);
      socket.off('theme:unlocked', onUnlock);
    };
  }, [dashboardChannel, socket]);

  function pushActivity(item: Activity) {
    setActivity((current) => [item, ...current].slice(0, 20));
  }

  function emitWithAck(event: string, payload: unknown) {
    setError(null);
    socket.emit(event, payload, (response: { ok: boolean; error?: string }) => {
      if (!response?.ok) setError(response?.error || 'Action failed');
    });
  }

  async function saveRules() {
    setError(null);
    const response = await fetch('/api/settings/theme-rules', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rules }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      setError(payload.error || 'Cannot save settings');
      return;
    }
    socket.emit('settings:update', { rules });
  }

  function updateRule(index: number, patch: Partial<ThemeRule>) {
    setRules((current) => current.map((rule, ruleIndex) => (ruleIndex === index ? { ...rule, ...patch } : rule)));
  }

  async function saveManualViewer(method: 'POST' | 'PUT', viewerUniqueId: string, themeSlugs: string[], nickname?: string) {
    setError(null);
    if (!dashboardChannel) {
      setError('Enter a channel UID before granting free themes');
      return false;
    }

    const response = await fetch('/api/viewers', {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        channelUniqueId: dashboardChannel,
        viewerUniqueId,
        nickname,
        themeSlugs,
      }),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      setError(payload.error || 'Cannot save viewer theme');
      return false;
    }

    setViewersVersion((current) => current + 1);
    return true;
  }

  async function deleteManualViewer(viewerUniqueId: string) {
    setError(null);
    if (!dashboardChannel) return;

    const response = await fetch('/api/viewers', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        channelUniqueId: dashboardChannel,
        viewerUniqueId,
      }),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      setError(payload.error || 'Cannot delete viewer theme');
      return;
    }

    setViewersVersion((current) => current + 1);
  }

  function testChat(tier: ThemeTier) {
    emitWithAck('test:chat', { tier, comment: `Test ${tier} chat message`, channelUniqueId: dashboardChannel });
  }

  return (
    <main className="control-room-shell">
      <LiveCommandBar
        uniqueId={uniqueId}
        setUniqueId={setUniqueId}
        state={state}
        error={error}
        onStart={() => emitWithAck('live:start', { uniqueId })}
        onStop={() => emitWithAck('live:stop', { uniqueId })}
      />

      <section className="control-room-layout">
        <div className="control-room-main">
          <QuickTestPanel
            onGiftVip={() => emitWithAck('test:gift', { diamonds: 10, giftName: 'VIP Gift', channelUniqueId: dashboardChannel })}
            onGiftDonator={() => emitWithAck('test:gift', { diamonds: 50, giftName: 'Donator Gift', channelUniqueId: dashboardChannel })}
            onChatNormal={() => testChat('normal')}
            onChatVip={() => testChat('vip')}
            onChatDonator={() => testChat('donator')}
            onFollow={() => emitWithAck('test:follow', { channelUniqueId: dashboardChannel })}
            onReset={() => emitWithAck('session:reset', { uniqueId: dashboardChannel })}
          />

          <ThemeRulesPanel
            rules={rules}
            channelUniqueId={dashboardChannel}
            onUpdateRule={updateRule}
            onSave={saveRules}
            onGrantTheme={(viewerUniqueId, themeSlug) => saveManualViewer('POST', viewerUniqueId, [themeSlug])}
          />
          <ActivityFeed activity={activity} />
          <SavedViewersTable
            viewers={viewers}
            rules={rules}
            onSaveManualThemes={(viewer, themeSlugs) => saveManualViewer('PUT', viewer.uniqueId, themeSlugs, viewer.nickname)}
            onDeleteManualThemes={(viewer) => deleteManualViewer(viewer.uniqueId)}
          />
        </div>

        <aside className="control-room-rail">
          <OverlayLinksPanel uniqueId={dashboardChannel} />
          <OverlayPreviewCards />
        </aside>
      </section>
    </main>
  );
}

function LiveCommandBar({
  uniqueId,
  setUniqueId,
  state,
  error,
  onStart,
  onStop,
}: {
  uniqueId: string;
  setUniqueId: (value: string) => void;
  state: LiveStatePayload;
  error: string | null;
  onStart: () => void;
  onStop: () => void;
}) {
  const statusLabel = state.state === 'connected' ? `@${state.channelUniqueId} live` : state.state;

  return (
    <header className="command-bar">
      <div className="brand-block">
        <span className="brand-mark">Live</span>
        <div>
          <h1>Live Studio</h1>
          <p>Stream controls and overlay routes.</p>
        </div>
      </div>

      <div className="live-console">
        <div className="status-pill" data-state={state.state}>
          <span className="status-dot" />
          {statusLabel}
        </div>
        <label className="live-id-field">
          <span>Channel</span>
          <input value={uniqueId} onChange={(event) => setUniqueId(event.target.value)} placeholder="@username" />
        </label>
        <button className="btn primary" onClick={onStart}>
          Start
        </button>
        <button className="btn danger" onClick={onStop}>
          Stop
        </button>
      </div>

      {error || state.error ? <div className="error-strip">{error || state.error}</div> : null}
    </header>
  );
}

function QuickTestPanel({
  onGiftVip,
  onGiftDonator,
  onChatNormal,
  onChatVip,
  onChatDonator,
  onFollow,
  onReset,
}: {
  onGiftVip: () => void;
  onGiftDonator: () => void;
  onChatNormal: () => void;
  onChatVip: () => void;
  onChatDonator: () => void;
  onFollow: () => void;
  onReset: () => void;
}) {
  return (
    <section className="ops-panel quick-panel">
      <PanelHeading title="Tests" subtitle="Send sample events." />
      <div className="test-grid">
        <TestButton tone="gift" label="Gift 10" meta="VIP threshold" onClick={onGiftVip} />
        <TestButton tone="gift" label="Gift 50" meta="Donator threshold" onClick={onGiftDonator} />
        <TestButton tone="chat" label="Chat" meta="Normal message" onClick={onChatNormal} />
        <TestButton tone="vip" label="VIP Chat" meta="Aino frame" onClick={onChatVip} />
        <TestButton tone="donator" label="Donator Chat" meta="Arlecchino frame" onClick={onChatDonator} />
        <TestButton tone="follow" label="Follow" meta="Follow alert" onClick={onFollow} />
        <TestButton tone="reset" label="Reset" meta="Session counters" onClick={onReset} />
      </div>
    </section>
  );
}

function TestButton({ tone, label, meta, onClick }: { tone: string; label: string; meta: string; onClick: () => void }) {
  return (
    <button className={`test-button ${tone}`} onClick={onClick}>
      <span className="test-icon" aria-hidden="true" />
      <span>
        <strong>{label}</strong>
        <small>{meta}</small>
      </span>
    </button>
  );
}

function OverlayLinksPanel({ uniqueId }: { uniqueId: string }) {
  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const normalizedUid = normalizeChannelUid(uniqueId);
  const displayUid = normalizedUid || 'your_uid';
  const pathUid = normalizedUid ? encodeURIComponent(normalizedUid) : displayUid;

  async function copyPath(path: string) {
    if (!normalizedUid) return;
    await navigator.clipboard.writeText(path);
    setCopiedPath(path);
    window.setTimeout(() => setCopiedPath((current) => (current === path ? null : current)), 1200);
  }

  return (
    <section className="ops-panel">
      <PanelHeading title="Outputs" subtitle="OBS browser sources." />
      <div className="overlay-link-list">
        {overlayLinks.map((link) => {
          const path = `/overlays/${pathUid}/${link.path}`;
          return (
            <article className={`overlay-link-card ${link.tone}`} key={link.path}>
              <a href={path} target="_blank" rel="noreferrer" aria-label={`Open ${link.label} overlay`}>
                <span>{link.label}</span>
                <code>{path}</code>
              </a>
              <button
                type="button"
                className="copy-path-button"
                aria-label={`Copy ${link.label} path`}
                title={normalizedUid ? `Copy ${link.label} path` : 'Enter channel UID first'}
                disabled={!normalizedUid}
                onClick={() => copyPath(path)}
              >
                <span className="copy-icon" aria-hidden="true" />
                <span className={`copy-status${copiedPath === path ? ' copied' : ''}`}>{copiedPath === path ? 'Copied' : 'Copy'}</span>
              </button>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function OverlayPreviewCards() {
  return (
    <section className="ops-panel">
      <PanelHeading title="Preview" subtitle="Small route references." />
      <div className="preview-stack">
        <div className="preview-card gift-preview">
          <span>Gift</span>
          <strong>Gift alert</strong>
          <small>Coins and character art</small>
        </div>
        <div className="preview-card chat-preview">
          <span>Chat</span>
          <strong>VIP / Donator frames</strong>
          <small>Theme route ready</small>
        </div>
        <div className="preview-card follow-preview">
          <span>Follow</span>
          <strong>Follower alert</strong>
          <small>Full overlay scale</small>
        </div>
      </div>
    </section>
  );
}

function ThemeRulesPanel({
  rules,
  channelUniqueId,
  onUpdateRule,
  onSave,
  onGrantTheme,
}: {
  rules: ThemeRule[];
  channelUniqueId: string;
  onUpdateRule: (index: number, patch: Partial<ThemeRule>) => void;
  onSave: () => void;
  onGrantTheme: (viewerUniqueId: string, themeSlug: string) => Promise<boolean>;
}) {
  const [manualInputs, setManualInputs] = useState<Record<string, string>>({});
  const [savingTheme, setSavingTheme] = useState<string | null>(null);

  async function grantTheme(themeSlug: string) {
    const viewerUniqueId = normalizeChannelUid(manualInputs[themeSlug]);
    if (!viewerUniqueId) return;
    setSavingTheme(themeSlug);
    const saved = await onGrantTheme(viewerUniqueId, themeSlug);
    if (saved) {
      setManualInputs((current) => ({ ...current, [themeSlug]: '' }));
    }
    setSavingTheme(null);
  }

  return (
    <section className="ops-panel">
      <PanelHeading title="Themes" subtitle="Unlock rules per channel." />
      <div className="theme-rule-list">
        {rules.map((rule, index) => (
          <article className="theme-rule-card" key={rule.themeSlug}>
            <div>
              <strong>{rule.themeSlug}</strong>
              <span>{rule.enabled ? 'Enabled' : 'Disabled'}</span>
            </div>
            <label>
              <span>Diamonds</span>
              <NumberStepper value={rule.thresholdDiamonds} onChange={(value) => onUpdateRule(index, { thresholdDiamonds: value })} />
            </label>
            <label>
              <span>Mode</span>
              <ModeSelect value={rule.unlockMode} onChange={(value) => onUpdateRule(index, { unlockMode: value })} />
            </label>
            <label className="toggle-field">
              <input type="checkbox" checked={rule.enabled} onChange={(event) => onUpdateRule(index, { enabled: event.target.checked })} />
              <span />
            </label>
            <div className="manual-theme-grant">
              <input
                value={manualInputs[rule.themeSlug] || ''}
                onChange={(event) => setManualInputs((current) => ({ ...current, [rule.themeSlug]: event.target.value }))}
                placeholder="@viewer_uid"
                aria-label={`Viewer UID for free ${rule.themeSlug} theme`}
              />
              <button
                type="button"
                className="round-add-button"
                aria-label={`Grant free ${rule.themeSlug} theme`}
                title={channelUniqueId ? `Grant free ${rule.themeSlug}` : 'Enter channel UID first'}
                disabled={!channelUniqueId || !normalizeChannelUid(manualInputs[rule.themeSlug]) || savingTheme === rule.themeSlug}
                onClick={() => grantTheme(rule.themeSlug)}
              >
                <span aria-hidden="true" />
              </button>
            </div>
          </article>
        ))}
      </div>
      <div className="panel-actions">
        <button className="btn primary" onClick={onSave}>
          Save
        </button>
      </div>
    </section>
  );
}

function NumberStepper({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  function commit(nextValue: number) {
    onChange(Math.max(0, nextValue));
  }

  return (
    <div className="number-stepper">
      <input type="text" inputMode="numeric" value={value} onChange={(event) => commit(Number(event.target.value.replace(/\D/g, '') || 0))} />
      <div className="stepper-actions" aria-label="Adjust diamonds">
        <button type="button" onClick={() => commit(value + 1)} aria-label="Increase diamonds">
          <span aria-hidden="true" />
        </button>
        <button type="button" onClick={() => commit(value - 1)} aria-label="Decrease diamonds">
          <span aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

function ModeSelect({ value, onChange }: { value: ThemeRule['unlockMode']; onChange: (value: ThemeRule['unlockMode']) => void }) {
  const [open, setOpen] = useState(false);
  const options: ThemeRule['unlockMode'][] = ['lifetime', 'session'];

  return (
    <div className="mode-select">
      <button type="button" className="mode-select-trigger" onClick={() => setOpen((current) => !current)} aria-haspopup="listbox" aria-expanded={open}>
        <span>{value === 'lifetime' ? 'Lifetime' : 'Session'}</span>
        <i aria-hidden="true" />
      </button>
      {open ? (
        <div className="mode-select-menu" role="listbox">
          {options.map((option) => (
            <button
              type="button"
              role="option"
              aria-selected={value === option}
              className={value === option ? 'selected' : undefined}
              key={option}
              onClick={() => {
                onChange(option);
                setOpen(false);
              }}
            >
              {option === 'lifetime' ? 'Lifetime' : 'Session'}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ActivityFeed({ activity }: { activity: Activity[] }) {
  return (
    <section className="ops-panel">
      <PanelHeading title="Activity" subtitle="Latest events." />
      <div className="activity-feed">
        {activity.length === 0 ? <div className="empty-row">No events yet.</div> : null}
        {activity.map((item, index) => (
          <ActivityItem key={index} item={item} />
        ))}
      </div>
    </section>
  );
}

function SavedViewersTable({
  viewers,
  rules,
  onSaveManualThemes,
  onDeleteManualThemes,
}: {
  viewers: SavedViewer[];
  rules: ThemeRule[];
  onSaveManualThemes: (viewer: SavedViewer, themeSlugs: string[]) => Promise<boolean>;
  onDeleteManualThemes: (viewer: SavedViewer) => void;
}) {
  const [editingViewerId, setEditingViewerId] = useState<string | null>(null);
  const [selectedThemes, setSelectedThemes] = useState<Record<string, string[]>>({});
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const normalizedQuery = query.trim().toLowerCase();
  const filteredViewers = useMemo(() => {
    if (!normalizedQuery) return viewers;
    return viewers.filter((viewer) => {
      return (
        viewer.nickname?.toLowerCase().includes(normalizedQuery) ||
        viewer.uniqueId?.toLowerCase().includes(normalizedQuery) ||
        viewer.channelUniqueId?.toLowerCase().includes(normalizedQuery)
      );
    });
  }, [normalizedQuery, viewers]);
  const pageCount = Math.max(1, Math.ceil(filteredViewers.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageViewers = filteredViewers.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  useEffect(() => {
    setPage(1);
  }, [normalizedQuery]);

  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  function startEdit(viewer: SavedViewer) {
    setEditingViewerId(viewer.viewerId);
    setSelectedThemes((current) => ({
      ...current,
      [viewer.viewerId]: viewer.manualThemes || [],
    }));
  }

  function toggleTheme(viewer: SavedViewer, themeSlug: string) {
    setSelectedThemes((current) => {
      const activeThemes = new Set(current[viewer.viewerId] || []);
      if (activeThemes.has(themeSlug)) {
        activeThemes.delete(themeSlug);
      } else {
        activeThemes.add(themeSlug);
      }
      return { ...current, [viewer.viewerId]: Array.from(activeThemes) };
    });
  }

  async function saveEdit(viewer: SavedViewer) {
    const saved = await onSaveManualThemes(viewer, selectedThemes[viewer.viewerId] || []);
    if (saved) setEditingViewerId(null);
  }

  return (
    <section className="ops-panel">
      <PanelHeading title="Viewers" subtitle="Saved unlocks by channel.">
        <label className="viewer-search">
          <span>Search</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find viewer" />
        </label>
      </PanelHeading>
      <div className="table-wrap">
        <table className="ops-table">
          <thead>
            <tr>
              <th>Channel</th>
              <th>Viewer</th>
              <th>Total coins</th>
              <th>Session</th>
              <th>Themes</th>
              <th>Free themes</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredViewers.length === 0 ? (
              <tr>
                <td colSpan={7}>{query ? 'No matching viewers.' : 'No saved viewers yet.'}</td>
              </tr>
            ) : (
              pageViewers.map((viewer) => {
                const isEditing = editingViewerId === viewer.viewerId;
                const activeManualThemes = selectedThemes[viewer.viewerId] || viewer.manualThemes || [];
                return (
                  <tr key={`${viewer.channelUniqueId}-${viewer.viewerId}`}>
                    <td>{viewer.channelUniqueId}</td>
                    <td>
                      <strong>{viewer.nickname || viewer.uniqueId}</strong>
                      <small>@{viewer.uniqueId}</small>
                    </td>
                    <td>{viewer.lifetimeDiamonds}</td>
                    <td>{viewer.currentLiveDiamonds}</td>
                    <td>{viewer.themes?.join(', ') || '-'}</td>
                    <td>
                      {isEditing ? (
                        <div className="viewer-theme-editor">
                          {rules.map((rule) => (
                            <label key={rule.themeSlug}>
                              <input
                                type="checkbox"
                                checked={activeManualThemes.includes(rule.themeSlug)}
                                onChange={() => toggleTheme(viewer, rule.themeSlug)}
                              />
                              <span>{rule.themeSlug}</span>
                            </label>
                          ))}
                        </div>
                      ) : (
                        viewer.manualThemes?.join(', ') || '-'
                      )}
                    </td>
                    <td>
                      <div className="viewer-actions">
                        {isEditing ? (
                          <>
                            <button type="button" onClick={() => saveEdit(viewer)}>
                              Save
                            </button>
                            <button type="button" onClick={() => setEditingViewerId(null)}>
                              Cancel
                            </button>
                          </>
                        ) : (
                          <>
                            <button type="button" onClick={() => startEdit(viewer)}>
                              Edit
                            </button>
                            <button type="button" className="danger-action" onClick={() => onDeleteManualThemes(viewer)}>
                              Delete
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      {filteredViewers.length > pageSize ? (
        <div className="viewer-pagination">
          <span>
            {Math.min((currentPage - 1) * pageSize + 1, filteredViewers.length)}-{Math.min(currentPage * pageSize, filteredViewers.length)} / {filteredViewers.length}
          </span>
          <div>
            <button type="button" disabled={currentPage <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>
              Prev
            </button>
            {Array.from({ length: pageCount }, (_, index) => index + 1).map((pageNumber) => (
              <button
                type="button"
                key={pageNumber}
                className={pageNumber === currentPage ? 'active' : undefined}
                onClick={() => setPage(pageNumber)}
              >
                {pageNumber}
              </button>
            ))}
            <button type="button" disabled={currentPage >= pageCount} onClick={() => setPage((current) => Math.min(pageCount, current + 1))}>
              Next
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function ActivityItem({ item }: { item: Activity }) {
  if (item.type === 'chat') {
    return (
      <div className="activity-row">
        <TypeBadge type="chat" />
        <strong>{item.payload.nickname}</strong>
        <span>{item.payload.comment}</span>
      </div>
    );
  }

  if (item.type === 'gift') {
    return (
      <div className="activity-row">
        <TypeBadge type="gift" />
        <strong>{item.payload.nickname}</strong>
        <span>
          {item.payload.giftName} / {item.payload.giftDiamonds} diamonds / total {item.payload.totalDiamonds}
        </span>
      </div>
    );
  }

  if (item.type === 'follow') {
    return (
      <div className="activity-row">
        <TypeBadge type="follow" />
        <strong>{item.payload.nickname}</strong>
        <span>New follower</span>
      </div>
    );
  }

  return (
    <div className="activity-row">
      <TypeBadge type="unlock" />
      <strong>{item.payload.uniqueId}</strong>
      <span>Unlocked {item.payload.themeSlug}</span>
    </div>
  );
}

function TypeBadge({ type }: { type: Activity['type'] }) {
  return <span className={`type-badge ${type}`}>{type}</span>;
}

function PanelHeading({ title, subtitle, children }: { title: string; subtitle: string; children?: ReactNode }) {
  return (
    <div className="panel-heading">
      <div>
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
      {children ? <div className="panel-heading-actions">{children}</div> : null}
    </div>
  );
}
