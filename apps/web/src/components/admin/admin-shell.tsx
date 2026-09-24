import Link from "next/link";

const NAV = [
  { href: "/admin", label: "Tổng quan" },
  { href: "/admin/titles", label: "Nội dung" },
  { href: "/admin/ingest", label: "Tải lên" },
  { href: "/admin/queue", label: "Hàng đợi" },
  { href: "/admin/storage", label: "Lưu trữ" },
  { href: "/admin/users", label: "Tài khoản" },
];

export function AdminShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh grid-cols-[220px_1fr] bg-zinc-100 text-zinc-900">
      <aside className="border-r border-zinc-300 bg-white p-4">
        <p className="mb-6 text-sm font-semibold tracking-widest text-zinc-500">
          MYFLIX ADMIN
        </p>
        <nav aria-label="Điều hướng quản trị">
          <ul className="space-y-1 text-sm">
            {NAV.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="block rounded px-3 py-2 hover:bg-zinc-100"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </aside>
      <main className="p-8">{children}</main>
    </div>
  );
}
