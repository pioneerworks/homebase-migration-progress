import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Homebase migration progress",
  description:
    "Live progress, page parity, migration decisions, and open questions from Linear.",
  robots: {
    index: false,
    follow: false,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
