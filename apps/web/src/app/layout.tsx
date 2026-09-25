import type { Metadata, Viewport } from "next";
import "../styles/global.css";

export const metadata: Metadata = {
  title: { default: "MyFlix", template: "%s · MyFlix" },
  description: "Nền tảng streaming video tự host",
};

export const viewport: Viewport = {
  themeColor: "#141414",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
