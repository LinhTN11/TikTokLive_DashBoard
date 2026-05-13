import { ChatOverlay } from '../../../../src/components/ChatOverlay';

export default async function Page({ params }: { params: Promise<{ themeSlug: string }> }) {
  const { themeSlug } = await params;
  return <ChatOverlay forcedTheme={themeSlug} />;
}
