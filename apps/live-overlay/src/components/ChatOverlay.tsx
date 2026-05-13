'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChatPayload } from '../lib/types';
import { getSocket } from '../lib/socket-client';

function normalizeChannelUid(value?: string) {
  return (value || '').trim().replace(/^@/, '');
}

export function ChatOverlay({ forcedTheme, channelUniqueId }: { forcedTheme?: string; channelUniqueId?: string }) {
  const activatedRef = useRef<Record<string, boolean>>({});
  const [messages, setMessages] = useState<ChatPayload[]>([]);
  const socket = useMemo(() => getSocket(), []);
  const targetChannel = normalizeChannelUid(channelUniqueId);

  useEffect(() => {
    const onChat = (payload: ChatPayload) => {
      if (targetChannel && normalizeChannelUid(payload.channelUniqueId) !== targetChannel) return;
      if (forcedTheme && !payload.themes.includes(forcedTheme)) return;
      setMessages((current) => [payload, ...current].slice(0, 5));
    };

    socket.on('event:chat', onChat);
    return () => {
      socket.off('event:chat', onChat);
    };
  }, [forcedTheme, socket, targetChannel]);

  return (
    <main className="overlay-stage">
      <link rel="stylesheet" href="/legacy/style.css" />
      <section className="main-container" aria-live="polite" style={{ justifyContent: 'center' }}>
        <div className="chat-list" style={{ justifyContent: 'center', flexGrow: 0, minHeight: '100vh' }}>
        {messages.map((message, index) => {
          const viewerKey = message.viewerId || message.uniqueId || `viewer-${index}`;
          const isDonator = (forcedTheme || message.activeTheme) === 'donator' || message.themes.includes('donator');
          const isVip = !isDonator && ((forcedTheme || message.activeTheme) === 'vip' || message.themes.includes('vip'));
          const activationKey = `${viewerKey}:${isDonator ? 'donator' : 'vip'}`;
          const firstActivation = (isDonator || isVip) && !activatedRef.current[activationKey];

          if (firstActivation) {
            activatedRef.current[activationKey] = true;
          }

          return <LegacyChatMessage key={`${message.uniqueId}-${index}`} message={message} isVip={isVip} isDonator={isDonator} firstActivation={firstActivation} />;
        })}
        </div>
        <div className="join-container" />
      </section>
    </main>
  );
}

function escapeText(value: string | undefined) {
  return value || '';
}

function emoteKey(value?: string) {
  return (value || '').replace(/^\[/, '').replace(/\]$/, '').toLowerCase();
}

function stripEmoteTokens(value: string) {
  return value.replace(/\[[^\]\s]{1,40}\]/g, '').replace(/\s{2,}/g, ' ').trim();
}

function ChatContent({ message, className }: { message: ChatPayload; className: string }) {
  const comment = escapeText(message.comment);
  const emotes = [...(message.emotes || [])];
  const used = new Set<number>();
  const tokenParts = comment.split(/(\[[^\]\s]{1,40}\])/g).filter((part) => part.length > 0);
  const hasTokenParts = tokenParts.some((part) => /^\[[^\]\s]{1,40}\]$/.test(part));

  if (emotes.length === 0) {
    return <div className={className}>{stripEmoteTokens(comment) || comment}</div>;
  }

  const consumeEmote = (token?: string) => {
    const normalizedToken = emoteKey(token);
    let index = emotes.findIndex((emote, emoteIndex) => {
      return !used.has(emoteIndex) && normalizedToken && emoteKey(emote.emoteId).includes(normalizedToken);
    });
    if (index < 0) {
      index = emotes.findIndex((_emote, emoteIndex) => !used.has(emoteIndex));
    }
    if (index >= 0) used.add(index);
    return index >= 0 ? emotes[index] : undefined;
  };

  const nodes = hasTokenParts
    ? tokenParts.flatMap((part, index) => {
        if (!/^\[[^\]\s]{1,40}\]$/.test(part)) return part;
        const emote = consumeEmote(part);
        return emote ? <ChatEmote key={`emote-${index}`} src={emote.emoteImageUrl} label={emote.emoteId || part} /> : '';
      })
    : [stripEmoteTokens(comment), ...emotes.map((emote, index) => <ChatEmote key={`emote-${index}`} src={emote.emoteImageUrl} label={emote.emoteId || 'emote'} />)];

  const remaining = emotes
    .map((emote, index) => ({ emote, index }))
    .filter(({ index }) => !used.has(index))
    .map(({ emote, index }) => <ChatEmote key={`remaining-${index}`} src={emote.emoteImageUrl} label={emote.emoteId || 'emote'} />);

  return (
    <div className={className}>
      {nodes}
      {remaining}
    </div>
  );
}

function ChatEmote({ src, label }: { src: string; label: string }) {
  return (
    <img
      className="chat-emote"
      src={src}
      alt={label}
      title={label}
      onError={(event) => {
        event.currentTarget.style.display = 'none';
      }}
    />
  );
}

function themeClass(uniqueId: string) {
  const themes = ['theme-pink', 'theme-green', 'theme-blue', 'theme-orange', 'theme-purple'];
  let hash = 0;
  for (let index = 0; index < uniqueId.length; index += 1) {
    hash = uniqueId.charCodeAt(index) + ((hash << 5) - hash);
  }
  return themes[Math.abs(hash) % themes.length];
}

function Avatar({ message }: { message: ChatPayload }) {
  return (
    <div className="avatar">
      <img
        src={message.profilePictureUrl || '/chat/UI_ItemIcon_203.png'}
        alt=""
        onError={(event) => {
          event.currentTarget.src = '/chat/UI_ItemIcon_203.png';
        }}
      />
    </div>
  );
}

function Sparkles() {
  const zones = [
    { edge: 'top', primary: '16%', secondary: '-10px', align: 'left', size: 14, delay: '0s' },
    { edge: 'top', primary: '78%', secondary: '-13px', align: 'left', size: 18, delay: '.32s' },
    { edge: 'bottom', primary: '24%', secondary: '-12px', align: 'left', size: 13, delay: '.72s' },
    { edge: 'bottom', primary: '82%', secondary: '-9px', align: 'left', size: 20, delay: '.18s' },
    { edge: 'left', primary: '22%', secondary: '-14px', align: 'top', size: 15, delay: '.48s' },
    { edge: 'left', primary: '70%', secondary: '-8px', align: 'top', size: 12, delay: '.96s' },
    { edge: 'right', primary: '18%', secondary: '-11px', align: 'top', size: 17, delay: '.62s' },
    { edge: 'right', primary: '74%', secondary: '-16px', align: 'top', size: 16, delay: '.84s' },
  ];

  return (
    <div className="sparkle-container">
      {zones.map((zone, index) => (
        <img
          key={index}
          className="sparkle"
          src="/chat/Item_Primogem.webp"
          alt=""
          style={{
            [zone.edge]: zone.secondary,
            [zone.align]: zone.primary,
            width: zone.size,
            height: zone.size,
            animationDelay: zone.delay,
          }}
        />
      ))}
    </div>
  );
}

function LegacyChatMessage({
  message,
  isVip,
  isDonator,
  firstActivation,
}: {
  message: ChatPayload;
  isVip: boolean;
  isDonator: boolean;
  firstActivation: boolean;
}) {
  const baseClass = isDonator
    ? 'message-row vip-frame arlec-donator-frame'
    : isVip
      ? `message-row vip-frame ${firstActivation ? 'vip-morph' : ''}`
      : `message-row ${themeClass(message.uniqueId || 'anon')}`;

  if (isDonator) {
    return (
      <div className={baseClass}>
        <ArlecChatFrame message={message} shouldMorph={firstActivation} />
      </div>
    );
  }

  if (isVip) {
    return (
      <div className={baseClass}>
        <Avatar message={message} />
        <div className="bubble" style={{ position: 'relative', overflow: 'visible' }}>
          <Sparkles />
          <img className="chibi-character" src="/chat/Aino (Edited).png" alt="" />
          <div className="vip-emblem">
            <img src="/chat/68258c779c36b-miHoYo.svg" alt="" />
          </div>
          <div className="username-badge">
            <img className="vip-badge-icon" src="/chat/UI_ItemIcon_203.png" alt="" />
            {escapeText(message.nickname || message.uniqueId)}
          </div>
          <ChatContent className="content" message={message} />
        </div>
      </div>
    );
  }

  return (
    <div className={baseClass}>
      <Avatar message={message} />
      <div className="bubble">
        <div className="username-badge">{escapeText(message.nickname || message.uniqueId)}</div>
        <ChatContent className="content" message={message} />
      </div>
    </div>
  );
}

function ArlecChatFrame({ message, shouldMorph }: { message: ChatPayload; shouldMorph: boolean }) {
  const name = escapeText(message.nickname || message.uniqueId || 'Donator');
  const comment = stripEmoteTokens(escapeText(message.comment));

  return (
    <div className={`arlec-chat-card is-speaking${shouldMorph ? ' is-morphing' : ''}`}>
      {shouldMorph ? (
        <div className="arlec-morph-origin" aria-hidden="true">
          <span className="arlec-morph-avatar" />
          <span className="arlec-morph-bubble">
            <span className="arlec-morph-name">{name}</span>
            <span className="arlec-morph-text">{comment}</span>
          </span>
        </div>
      ) : null}

      <div className="arlec-character-wrap" aria-hidden="true">
        <img className="arlec-character-img" src="/chat/demo-character.png" alt="" />
      </div>

      <div className="arlec-name-row">
        <span className="arlec-name" data-text={name}>
          {name}
        </span>
        {[1, 2, 3, 4].map((index) => (
          <span key={index} className={`arlec-pixel-glitch arlec-pixel-glitch-${index}`} />
        ))}
      </div>
      <img className="arlec-donator-badge" src="/chat/badge%20logo.png" alt="" />
      <img className="arlec-logo" src="/chat/logo-arlec.png" alt="Arlecchino" />

      <img className="arlec-thorn arlec-thorn-g4" src="/chat/gai/g4.png" alt="" />
      <img className="arlec-thorn arlec-thorn-g8-2" src="/chat/gai/g8-2.png" alt="" />
      <img className="arlec-thorn arlec-thorn-g8" src="/chat/gai/g8.png" alt="" />
      <img className="arlec-thorn arlec-thorn-g6" src="/chat/gai/g6.png" alt="" />
      <img className="arlec-thorn arlec-thorn-g2" src="/chat/gai/g2.png" alt="" />
      <div className="arlec-chat-stars" aria-hidden="true">
        {Array.from({ length: 12 }, (_, index) => (
          <span key={index} className={`arlec-star arlec-star-${index + 1}`} />
        ))}
      </div>

      <div className="arlec-bubble-wrap">
        <img className="arlec-wing-exact" src="/chat/wing-exact.png" alt="" />
        <span className="arlec-edge-glint arlec-edge-glint-top" />
        <span className="arlec-edge-glint arlec-edge-glint-left" />
        <span className="arlec-edge-glint arlec-edge-glint-right" />
        <div className="arlec-bubble">
          <ChatContent className="arlec-content" message={message} />
        </div>
        {Array.from({ length: 12 }, (_, index) => (
          <span key={index} className={`arlec-edge-fragment arlec-fragment-${index + 1}`} />
        ))}
        <img className="arlec-wing-exact-layout" src="/chat/wing-exact-layout.png" alt="" />
      </div>
    </div>
  );
}
