export default async function GenrePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  // TODO(phase-5): paginated grid for a genre.
  return (
    <section className="page-x pt-[calc(var(--size-header)+2rem)]">Thể loại: {slug}</section>
  );
}
