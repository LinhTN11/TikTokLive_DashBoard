import { GiftOverlay } from '../../../../src/components/GiftOverlay';

export default async function Page({ params }: { params: Promise<{ channelUniqueId: string }> }) {
  const { channelUniqueId } = await params;
  return <GiftOverlay channelUniqueId={decodeURIComponent(channelUniqueId)} />;
}
