import type { ChatPayload, ThemeTier } from '../../lib/types';

export interface ChatThemeDefinition {
  slug: string;
  label: string;
  tier: ThemeTier;
  defaultEnabled: boolean;
  assetHints: string[];
  render: (message: ChatPayload) => React.ReactNode;
}

function Avatar({ message }: { message: ChatPayload }) {
  return (
    <img
      className="chat-avatar"
      src={message.profilePictureUrl || '/legacy/chat/UI_ItemIcon_203.png'}
      alt=""
      onError={(event) => {
        event.currentTarget.src = '/legacy/chat/UI_ItemIcon_203.png';
      }}
    />
  );
}

function BaseBubble({ message, label }: { message: ChatPayload; label?: string }) {
  return (
    <>
      <Avatar message={message} />
      <div className="chat-bubble">
        <span className="chat-name">
          {message.nickname || message.uniqueId}
          {label ? ` · ${label}` : ''}
        </span>
        <span>{message.comment}</span>
      </div>
    </>
  );
}

export const chatThemes: ChatThemeDefinition[] = [
  {
    slug: 'vip',
    label: 'VIP',
    tier: 'vip',
    defaultEnabled: true,
    assetHints: ['/legacy/chat/Aino (Edited).png', '/legacy/chat/Item_Primogem.webp'],
    render: (message) => <BaseBubble message={message} label="VIP" />,
  },
  {
    slug: 'donator',
    label: 'Donator',
    tier: 'donator',
    defaultEnabled: true,
    assetHints: ['/legacy/chat/logo-arlec.png', '/legacy/chat/demo-character.png'],
    render: (message) => <BaseBubble message={message} label="Donator" />,
  },
];

export function getTheme(slug: string | undefined) {
  if (!slug) return undefined;
  return chatThemes.find((theme) => theme.slug === slug);
}

export function chooseTheme(message: ChatPayload, forcedTheme?: string) {
  if (forcedTheme) return getTheme(forcedTheme);
  const active = message.activeTheme || message.themes[0];
  return getTheme(active);
}
