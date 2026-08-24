import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { BottomNav, SideNav } from "@/components/nav";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Aquaman — Aquarium Care",
  description:
    "Self-hosted aquarium care & water tracking with flexible scheduling and ICS calendar",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        {/* Issue #21: nav lives HERE (root layout) so no page can lose it again */}
        <div className="flex min-h-dvh flex-1">
          <SideNav />
          {children}
        </div>
        <BottomNav />
      </body>
    </html>
  );
}
