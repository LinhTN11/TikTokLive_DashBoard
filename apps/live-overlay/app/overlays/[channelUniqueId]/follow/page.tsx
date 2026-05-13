import { FollowOverlay } from '../../../../src/components/FollowOverlay';

export default async function Page({ params }: { params: Promise<{ channelUniqueId: string }> }) {
  const { channelUniqueId } = await params;
  return <FollowOverlay channelUniqueId={decodeURIComponent(channelUniqueId)} />;
}
