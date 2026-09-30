import type { Metadata } from "next";
import { Titillium_Web, Azeret_Mono } from "next/font/google";
import "./globals.css";
import { THEME_BOOT_SCRIPT } from "@/lib/theme";

const titillium = Titillium_Web({
  variable: "--font-titillium",
  subsets: ["latin"],
  weight: ["400", "600", "700"],
});

const azeret = Azeret_Mono({
  variable: "--font-azeret",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Flat Rate Tracker",
  description: "Log repair orders and reconcile flagged hours vs. paid hours",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // data-theme / data-accent are rendered with the defaults so a page is
    // never token-less: if React ever re-renders <html> from these props
    // (hydration recovery), the worst case is the default look, not a blank
    // palette. The <head> script swaps in the saved choice before first paint.
    <html
      lang="en"
      suppressHydrationWarning
      data-theme="dark"
      data-accent="blue"
      data-panel="accent"
      className={`${titillium.variable} ${azeret.variable} h-full antialiased`}
    >
      <head>
        <script
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }}
        />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
