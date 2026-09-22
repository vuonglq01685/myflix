export default async function AdminTitleEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // TODO(phase-3): metadata form, artwork upload, seasons/episodes, subtitles.
  return <h1 className="text-2xl font-semibold">Title {id}</h1>;
}
