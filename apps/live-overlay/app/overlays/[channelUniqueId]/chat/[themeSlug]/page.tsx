import { ChatOverlay } from '../../../../../src/components/ChatOverlay';

export default async function Page({
  params,
}: {
  params: Promise<{ channelUniqueId: string; themeSlug: string }>;
}) {
  const { channelUniqueId, themeSlug } = await params;
  return <ChatOverlay channelUniqueId={decodeURIComponent(channelUniqueId)} forcedTheme={themeSlug} />;
}
