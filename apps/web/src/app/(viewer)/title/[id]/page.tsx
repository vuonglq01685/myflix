import { TitleDetail } from '@/components/browse/title-detail';

/** The same URL opened directly (or refreshed) renders a full page. */
export default async function TitlePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TitleDetail titleId={id} />;
}
