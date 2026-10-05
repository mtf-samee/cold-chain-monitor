import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Freeze Pharma",
  description: "Real-time thermal telemetry and breach incident logging.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
    <body className="antialiased bg-slate-900">
    {children}
    </body>
    </html>
  );
}
