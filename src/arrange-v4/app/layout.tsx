import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/components/AuthProvider";
import VersionBadge from "@/components/VersionBadge";
import HamburgerMenu from "@/components/HamburgerMenu";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Arrange V4",
  description: "Task management with Eisenhower Matrix",
  icons: {
    icon: [
      { url: `${process.env.NEXT_PUBLIC_BASE_PATH || ""}/icon-192.png`, sizes: "192x192", type: "image/png" },
      { url: `${process.env.NEXT_PUBLIC_BASE_PATH || ""}/icon-512.png`, sizes: "512x512", type: "image/png" },
    ],
    apple: `${process.env.NEXT_PUBLIC_BASE_PATH || ""}/apple-icon.png`,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        <AuthProvider>
          <HamburgerMenu />
          <VersionBadge />
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
