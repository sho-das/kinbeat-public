import type { Metadata } from "next";
import { Arvo, Caveat, IBM_Plex_Mono, Inter, Space_Grotesk } from "next/font/google";
import "./globals.css";
import { site } from "./lib/site";

const arvo = Arvo({ subsets: ["latin"], weight: ["400", "700"], variable: "--font-arvo", display: "swap" });
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
// The home page fonts from the chosen mock-up: Space Grotesk for headings, IBM Plex Mono for code-like text.
const grotesk = Space_Grotesk({ subsets: ["latin"], weight: ["500", "700"], variable: "--font-grotesk", display: "swap" });
const plexMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "600"], variable: "--font-plex", display: "swap" });
// The handwritten note next to the circled key.
const caveat = Caveat({ subsets: ["latin"], weight: ["600"], variable: "--font-hand", display: "swap" });

const title = "KinBeat | Finds exposed tokens for free";
const description =
  "Scan text, files, websites, GitHub, Google Drive and Slack chats";

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
    <html lang="en" className={`${arvo.variable} ${inter.variable} ${grotesk.variable} ${plexMono.variable} ${caveat.variable}`} suppressHydrationWarning>
      <head>
        {/* Marks that scripts run, before the first paint, so animated parts can wait hidden instead of flashing their end state. */}
        <script dangerouslySetInnerHTML={{ __html: "document.documentElement.classList.add('js')" }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
