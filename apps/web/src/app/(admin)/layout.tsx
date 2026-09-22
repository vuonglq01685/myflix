import { AdminShell } from '@/components/admin/admin-shell';

/**
 * A separate route group, so this is a completely independent component tree
 * from the viewer — dense, functional, light (D-5 / ADR-009). Next.js
 * code-splits per route, so viewers never download any of it.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
