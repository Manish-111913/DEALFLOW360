import type { Config } from "tailwindcss";
import forms from "@tailwindcss/forms";
import containerQueries from "@tailwindcss/container-queries";

/**
 * The union of the seven screens' own Tailwind configs.
 *
 * Two deliberate departures from simply merging them:
 *
 * 1. `sans` and `mono` are NOT overridden. The families are exposed under their
 *    own names - `font-jakarta`, `font-jetbrains` - and each screen names the
 *    one it uses, so nothing is restyled by a global default changing.
 *
 *    The seven screens originally disagreed: `font-sans` was Inter on the
 *    command centre, approvals and deal health, and Plus Jakarta Sans on the
 *    workspace, fulfilment, billing and portal. That 4/3 split was faithful to
 *    the source designs but read as two products, so it was settled on Plus
 *    Jakarta Sans - the family of Subscription & Billing, the reference screen.
 *    The `inter` utility is gone rather than left unused; Inter survives only
 *    as the fallback inside the stacks below, for the moment before the
 *    webfont lands.
 *
 *    `font-mono` had the same problem and is now unused too. Because `mono` is
 *    not overridden here, that class resolved to the browser's own monospace -
 *    Consolas on Windows - so a quote reference rendered in Consolas on
 *    fulfilment and billing while the command centre showed JetBrains Mono.
 *    Every mono readout now says `font-jetbrains`, which is a font we load.
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
