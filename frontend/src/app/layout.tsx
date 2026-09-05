import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DealFlow360",
  description: "Self-governing B2B sales operations platform",
};

/**
 * Fonts are loaded by <link> rather than next/font on purpose.
 *
 * The screens were designed against these exact Google Fonts stylesheets, down
 * to the variable-axis ranges (Material Symbols needs its FILL/wght/GRAD/opsz
 * axes, which globals.css then sets). next/font would self-host and rename the
 * families, so a class like `font-jakarta` would have to be rewired; keeping the
 * original <link> tags means the rendered result matches the source screens.
 *
 * The body sets no font family. Each screen picks its own - Inter on the
 * command centre, approvals and deal health; Plus Jakarta Sans on the
 * workspace, fulfilment, billing and portal - because the source screens
 * disagreed and we are reproducing them exactly.
 */
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      {/* eslint-disable @next/next/no-page-custom-font -- that rule is about
          the Pages Router's _document.js. This IS the App Router's single root
          layout, so these links are on every page already. */}
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@100..900&family=Plus+Jakarta+Sans:wght@200..800&family=JetBrains+Mono:wght@400;500;600;700&display=swap"
        />
        {/* Material Symbols renders icons from ligature text, so `swap` or
            `optional` would show the literal words - "check_circle",
            "local_shipping" - until the font lands, and `optional` can leave
            them there permanently on a slow connection. `block` holds the glyph
            back instead, which is the right trade for an icon font even though
            the generic rule prefers otherwise. */}
        {/* eslint-disable-next-line @next/next/google-font-display */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=block"
        />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
