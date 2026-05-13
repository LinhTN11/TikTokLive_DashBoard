'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { FollowPayload } from '../lib/types';
import { getSocket } from '../lib/socket-client';

function normalizeChannelUid(value?: string) {
  return (value || '').trim().replace(/^@/, '');
}

export function FollowOverlay({ channelUniqueId }: { channelUniqueId?: string }) {
  const queueRef = useRef<FollowPayload[]>([]);
  const animatingRef = useRef(false);
  const [follow, setFollow] = useState<FollowPayload | null>(null);
  const [animationId, setAnimationId] = useState(0);
  const socket = useMemo(() => getSocket(), []);
  const targetChannel = normalizeChannelUid(channelUniqueId);

  useEffect(() => {
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const playNext = () => {
      if (animatingRef.current || queueRef.current.length === 0) return;
      animatingRef.current = true;
      setFollow(queueRef.current.shift() || null);
      setAnimationId((current) => current + 1);

      const doneTimer = setTimeout(() => {
        setFollow(null);
        animatingRef.current = false;
        playNext();
      }, 5700);
      timers.add(doneTimer);
    };

    const onFollow = (payload: FollowPayload) => {
      if (targetChannel && normalizeChannelUid(payload.channelUniqueId) !== targetChannel) return;
      queueRef.current.push(payload);
      playNext();
    };

    socket.on('event:follow', onFollow);
    return () => {
      timers.forEach((timer) => clearTimeout(timer));
      socket.off('event:follow', onFollow);
    };
  }, [socket, targetChannel]);

  return (
    <main className="overlay-stage legacy-follow-stage" aria-live="polite">
      <link rel="stylesheet" href="/legacy/follower.css" />
      {follow ? (
        <section
          key={animationId}
          id="notification-container"
          className="legacy-follow-animation"
          style={{ transform: 'translate(-50%, -50%) scale(0.72)' }}
        >
          <div id="bg-panel" className="asset" />
          <div id="cloud-ornament" className="asset" />
          <div id="tr-ornament" className="asset" />
          <div id="star-ornament" className="asset" />
          <div id="character-art" className="asset" />
          <div id="text-content">
            <span id="username">{(follow.nickname || follow.uniqueId || 'Traveler').toUpperCase()}</span>
            <span id="action-text">Started Following</span>
          </div>
        </section>
      ) : null}
    </main>
  );
}
