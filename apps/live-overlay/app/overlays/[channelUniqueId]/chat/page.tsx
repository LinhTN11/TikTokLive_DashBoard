import { ChatOverlay } from '../../../../src/components/ChatOverlay';

export default async function Page({ params }: { params: Promise<{ channelUniqueId: string }> }) {
  const { channelUniqueId } = await params;
  return <ChatOverlay channelUniqueId={decodeURIComponent(channelUniqueId)} />;
}
