import type { Metadata } from "next";
import { Playfair_Display, Special_Elite } from "next/font/google";
import "./globals.css";

const playfair = Playfair_Display({
  variable: "--font-playfair",
  subsets: ["latin"],
  weight: ["700", "900"],
});

const specialElite = Special_Elite({
  variable: "--font-typewriter",
  subsets: ["latin"],
  weight: "400",
});

export const metadata: Metadata = {
  title: "Just for Today",
  description: "A daily ritual. Not a productivity app.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${playfair.variable} ${specialElite.variable}`}>
      <body className="min-h-screen" style={{ background: "var(--background)", color: "var(--foreground)", fontFamily: "var(--font-typewriter)" }}>
        {children}
      </body>
    </html>
  );
}
