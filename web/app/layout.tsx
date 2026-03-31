import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OSG Web",
  description: "OpenSessionGateway monitor UI",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
