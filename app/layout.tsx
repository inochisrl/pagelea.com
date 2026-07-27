import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Manrope } from "next/font/google";
import { AnalyticsBeacon } from "./components/AnalyticsBeacon";
import "./globals.css";

const PAGELEA_ORIGIN = new URL("https://pagelea.com");

const display = Bricolage_Grotesque({
  variable: "--font-display",
  subsets: ["latin"],
});

const body = Manrope({
  variable: "--font-body",
  subsets: ["latin"],
});

// The runtime currently omits viewportFit from generated viewport metadata.
// Suppress its default tag so the complete manual tag below is authoritative.
export const viewport: Viewport = {
  initialScale: undefined,
  width: undefined,
};

export function generateMetadata(): Metadata {
  return {
    metadataBase: PAGELEA_ORIGIN,
    title: {
      default: "Pagelea — Free, open-source PDF tools",
      template: "%s · Pagelea",
    },
    description:
      "Rewrite native or scanned PDF text with local OCR, then merge, organize, optimize, split and sign documents with eight free, open-source browser tools.",
    applicationName: "Pagelea",
    keywords: [
      "PDF editor",
      "OCR PDF",
      "edit scanned PDF",
      "merge PDF",
      "optimize PDF",
      "split PDF",
      "sign PDF",
    ],
    openGraph: {
      title: "Pagelea — Free, open-source PDF tools",
      description:
        "Eight free PDF tools with no account, online purchase flow or artificial task quota. Document bytes are processed locally in your browser.",
      type: "website",
      images: [
        {
          url: new URL("/og.png", PAGELEA_ORIGIN).toString(),
          width: 1200,
          height: 630,
          alt: "Pagelea — Change PDF text without uploading it.",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: "Pagelea — Free, open-source PDF tools",
      description:
        "Eight free PDF tools with no account, online purchase flow or artificial task quota. Document bytes are processed locally in your browser.",
      images: [new URL("/og.png", PAGELEA_ORIGIN).toString()],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta
          content="width=device-width, initial-scale=1, viewport-fit=cover"
          name="viewport"
        />
        <link rel="icon" href="/favicon.png" />
        <link rel="shortcut icon" href="/favicon.png" />
      </head>
      <body className={`${display.variable} ${body.variable}`}>
        <AnalyticsBeacon />
        {children}
      </body>
    </html>
  );
}
