import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Freeze Pharm",
  description: "Pharmaceutical cold-chain monitoring system",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
    <body>
    {children}
    </body>
    </html>
  );
}
