import { SiteHeader } from "@/components/layout/site-header";

/**
 * Viewer shell. `modal` is a parallel route slot: the detail view renders on
 * top of whatever is already on screen when navigated to from a card, and as
 * a full page when the URL is opened cold (ADR-008).
 */
export default function ViewerLayout({
  children,
  modal,
}: {
  children: React.ReactNode;
  modal: React.ReactNode;
}) {
  return (
    <>
      <SiteHeader />
      <main id="main">{children}</main>
      {modal}
    </>
  );
}
