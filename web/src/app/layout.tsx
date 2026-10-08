import type { Metadata, Viewport } from "next";
import { Archivo, Hanken_Grotesk } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const num = Archivo({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-num", display: "swap" });
const text = Hanken_Grotesk({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-text", display: "swap" });

export const metadata: Metadata = {
  title: "Lane",
  description: "Your counter takes card now. Without the card machine.",
};

export const viewport: Viewport = { themeColor: "#F6F2EA", width: "device-width", initialScale: 1, viewportFit: "cover" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Reading the request makes every page render per request, so Next applies the CSP nonce to its scripts.
  await headers();
  return (
    <html lang="en" className={`${num.variable} ${text.variable}`}>
      <body>{children}</body>
    </html>
  );
}
