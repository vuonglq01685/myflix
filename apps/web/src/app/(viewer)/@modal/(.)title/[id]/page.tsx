import { TitleDetailModal } from '@/components/browse/title-detail-modal';

/** Intercepts /title/[id] when navigated to client-side. Back closes it. */
export default async function InterceptedTitlePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <TitleDetailModal titleId={id} />;
}
