import type { Config } from "tailwindcss";
import forms from "@tailwindcss/forms";
import containerQueries from "@tailwindcss/container-queries";

/**
 * The union of the seven screens' own Tailwind configs.
 *
 * Two deliberate departures from simply merging them:
 *
 * 1. `sans` and `mono` are NOT overridden. Each screen set them to something
 *    different - `font-sans` is Inter on the command centre, approvals and deal
 *    health, and Plus Jakarta Sans on the workspace, fulfilment, billing and
 *    portal; `font-mono` is JetBrains Mono on four screens and the browser
 *    default on the other three, which never configured it. A single global
 *    value would silently restyle whichever screens lost the vote, so the
 *    families are exposed under their own names - `font-inter`, `font-jakarta`,
 *    `font-jetbrains` - and each screen names the one it was designed with.
 *    Anything left on plain `font-mono` is a screen that wanted the default.
 *
 * 2. The `brand` and `primary` palettes every screen declared are omitted: not
 *    one of the seven files uses a single `*-brand-*` or `*-primary-*` class.
 *    They were dead config, and carrying them over would only invite use of a
 *    colour the design never actually shows.
 */
const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        inter: ["Inter", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "Roboto", "sans-serif"],
        jakarta: ['"Plus Jakarta Sans"', "Inter", "system-ui", "sans-serif"],
        display: ['"Plus Jakarta Sans"', "Inter", "sans-serif"],
        jetbrains: ['"JetBrains Mono"', "monospace"],
      },
      boxShadow: {
        subtle: "0 1px 3px 0 rgba(0, 0, 0, 0.04), 0 1px 2px -1px rgba(0, 0, 0, 0.02)",
        card: "0 1px 3px 0 rgba(15, 23, 42, 0.04), 0 2px 6px -1px rgba(15, 23, 42, 0.02)",
      },
    },
  },
  plugins: [forms, containerQueries],
};

export default config;
