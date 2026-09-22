import { PlayerShell } from '@/components/player/player-shell';

export default async function WatchPage({ params }: { params: Promise<{ assetId: string }> }) {
  const { assetId } = await params;
  return <PlayerShell assetId={assetId} />;
}
