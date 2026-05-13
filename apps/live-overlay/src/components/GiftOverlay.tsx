'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { GiftPayload } from '../lib/types';
import { getSocket } from '../lib/socket-client';

const charImages = [
  'Icon_Emoji_Paimon%27s_Paintings_02_Sucrose_1.webp',
  'Icon_Emoji_Paimon%27s_Paintings_11_Gorou_3.webp',
  'Icon_Emoji_Paimon%27s_Paintings_12_Yun_Jin_1.webp',
  'Icon_Emoji_Paimon%27s_Paintings_14_Venti_4.webp',
  'Icon_Emoji_Paimon%27s_Paintings_35_Kachina_1.webp',
  'Icon_Emoji_Paimon%27s_Paintings_35_Kinich_2.webp',
  'Icon_Emoji_Paimon%27s_Paintings_35_Mualani_2.webp',
  'Icon_Emoji_Paimon%27s_Paintings_36_Nahida_1.webp',
  'Icon_Emoji_Paimon%27s_Paintings_38_Hu_Tao_1.webp',
  'Icon_Emoji_Paimon%27s_Paintings_38_Hu_Tao_2.webp',
  'Icon_Emoji_Paimon%27s_Paintings_38_Mavuika_2.webp',
  'Icon_Emoji_Paimon%27s_Paintings_40_Varesa_1.webp',
  'Icon_Emoji_Paimon%27s_Paintings_43_Aino_1.webp',
  'Icon_Emoji_Paimon%27s_Paintings_45_Arlecchino_1.webp',
];

function normalizeChannelUid(value?: string) {
  return (value || '').trim().replace(/^@/, '');
}

export function GiftOverlay({ channelUniqueId }: { channelUniqueId?: string }) {
  const queueRef = useRef<GiftPayload[]>([]);
  const processingRef = useRef(false);
  const [gift, setGift] = useState<GiftPayload | null>(null);
  const [isFading, setIsFading] = useState(false);
  const socket = useMemo(() => getSocket(), []);
  const targetChannel = normalizeChannelUid(channelUniqueId);

  useEffect(() => {
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const processQueue = () => {
      if (processingRef.current || queueRef.current.length === 0) return;
      processingRef.current = true;
      setIsFading(false);
      setGift(queueRef.current.shift() || null);

      const holdTimer = setTimeout(() => {
        setIsFading(true);
        const removeTimer = setTimeout(() => {
          setGift(null);
          setIsFading(false);
          processingRef.current = false;
          processQueue();
        }, 800);
        timers.add(removeTimer);
      }, 5000);
      timers.add(holdTimer);
    };

    const onGift = (payload: GiftPayload) => {
      if (targetChannel && normalizeChannelUid(payload.channelUniqueId) !== targetChannel) return;
      queueRef.current.push(payload);
      processQueue();
    };

    socket.on('event:gift', onGift);
    return () => {
      timers.forEach((timer) => clearTimeout(timer));
      socket.off('event:gift', onGift);
    };
  }, [socket, targetChannel]);

  return (
    <main className="overlay-stage legacy-gift-stage" aria-live="polite">
      <link rel="stylesheet" href="/legacy/gift.css" />
      <section className="gift-container" id="giftContainer">
        {gift ? <LegacyGiftCard gift={gift} isFading={isFading} /> : null}
      </section>
    </main>
  );
}

function formatCoins(num: number) {
  if (num >= 1000000) return `${String((num / 1000000).toFixed(1)).replace(/\.0$/, '')}M`;
  if (num >= 1000) return `${String((num / 1000).toFixed(1)).replace(/\.0$/, '')}k`;
  return String(num);
}

function getRandomChars(seed: string) {
  const chars = [...charImages];
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash << 5) - hash + seed.charCodeAt(index);
    hash |= 0;
  }
  chars.sort((a, b) => {
    const av = Math.abs(hash + a.charCodeAt(0) * 31 + a.length);
    const bv = Math.abs(hash + b.charCodeAt(0) * 31 + b.length);
    return av - bv;
  });
  const count = Math.abs(hash % 3) + 3;
  return chars.slice(0, count);
}

function LegacyGiftCard({ gift, isFading }: { gift: GiftPayload; isFading: boolean }) {
  const selectedChars = getRandomChars(`${gift.uniqueId}:${gift.giftName}:${gift.totalDiamonds}`);
  const centerIndex = (selectedChars.length - 1) / 2;
  const displayNickname = (gift.nickname || gift.uniqueId || 'Viewer').length > 15
    ? `${(gift.nickname || gift.uniqueId).slice(0, 15)}...`
    : gift.nickname || gift.uniqueId || 'Viewer';

  return (
    <div className={`gift-card${isFading ? ' fade-out' : ''}`}>
      <div className="main-headline">Chúc mừng năm mới</div>
      <div className="sub-headline">
        <span className="user-text" title={gift.nickname || gift.uniqueId}>
          {displayNickname} đã lì xì bạn <span className="coin-count">{formatCoins(gift.giftDiamonds || gift.diamondCost * gift.repeatCount)}</span>
          <img src="/gift_noti/Coins.webp" className="coin-icon" alt="" />
        </span>
      </div>
      <div className="char-container">
        {selectedChars.map((img, index) => {
          const offset = index - centerIndex;
          const translateY = Math.abs(offset) * 15;
          const rotate = offset * 5;
          const zIndex = 10 - Math.abs(offset);
          return (
            <img
              key={img}
              src={`/gift_noti/char/${encodeURIComponent(img)}`}
              className="char-img"
              alt=""
              style={{
                animationDelay: `${index * 0.1}s`,
                transform: `translateY(${translateY}px) rotate(${rotate}deg)`,
                zIndex,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
