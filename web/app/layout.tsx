import type { Metadata } from "next";
import { Arvo, Inter } from "next/font/google";
import "./globals.css";
import { site } from "./lib/site";

const arvo = Arvo({ subsets: ["latin"], weight: ["400", "700"], variable: "--font-arvo", display: "swap" });
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

const title = "KinBeat - Find exposed tokens before hackers do";
const description =
  "Find your exposed tokens before hackers do. Scan chats, PDFs, Word files and images. Free scan.";

export const metadata: Metadata = {
  metadataBase: new URL(site),
  title,
  description,
  alternates: { canonical: "/" },
  openGraph: { title, description, type: "website", url: "/", siteName: "KinBeat" },
  twitter: { card: "summary", title, description },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${arvo.variable} ${inter.variable}`}>
      <body>{children}</body>
    </html>
  );
}
