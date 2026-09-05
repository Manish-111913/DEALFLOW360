/**
 * The type scale and spacing every screen uses, taken from Subscription &
 * Billing.
 *
 * The seven screens were drawn independently, so the same role was rendered at
 * a different size on each: the page title was text-xl on billing and sales,
 * text-2xl on approvals and the portal, and text-2xl/3xl on the command centre;
 * weights ran bold / extrabold / black; the window chrome was h-11, h-12,
 * h-[52px] and h-14; the scroll region was padded p-6, px-6 py-5, px-5 sm:px-8
 * py-5 and p-4 md:p-6. Side by side that reads as five different products.
 *
 * Billing is the reference, so its values are named here once and imported
 * rather than retyped. Anything genuinely specific to one screen - the portal's
 * quotation totals, the deal-health gauge - keeps its own classes; these cover
 * the roles that repeat on every screen.
 *
 * A note on shadows: billing's cards carry `shadow-2xs`, which is a Tailwind 4
 * class and therefore does nothing under the Tailwind 3 the screens were drawn
 * against. Its cards are border-only, and CARD reproduces that exactly, so the
 * other screens lose the `shadow-sm` they had. That is the intended result -
 * flat cards with a hairline border is what the reference screen looks like.
 */

// ---------------------------------------------------------------------------
// Window chrome
// ---------------------------------------------------------------------------

/** The macOS title bar at the top of every window. */
export const CHROME_BAR =
  "h-12 shrink-0 px-4 flex items-center justify-between border-b border-slate-200/80 bg-slate-50/70 select-none";

/** The strip holding the page title and its primary actions. */
export const PAGE_HEADER = "shrink-0 border-b border-slate-200/80 px-6 py-3.5 bg-white";

/** A secondary strip under the title - KPIs, filters, summary numbers. */
export const SUB_HEADER =
  "shrink-0 border-b border-slate-200/80 px-6 py-2.5 bg-slate-50/70";

/** Padding for the one scroll region. Pass to <WindowScroll className=...>. */
export const SCROLL_PADDING = "p-6 space-y-6";

// ---------------------------------------------------------------------------
// Type scale
// ---------------------------------------------------------------------------

/** The page title, once per screen. */
export const PAGE_TITLE = "text-xl font-bold text-slate-900 tracking-tight";

/** The sentence under the page title. */
export const PAGE_SUBTITLE = "text-xs text-slate-500 mt-0.5";

/** Breadcrumbs above the title. */
export const BREADCRUMB = "text-[11px] text-slate-500 flex items-center space-x-1.5";

/** A card's heading. */
export const CARD_TITLE = "text-sm font-bold text-slate-900";

/** The line under a card heading. */
export const CARD_SUBTITLE = "text-xs text-slate-500 mt-0.5";

/** A small all-caps heading inside a card. */
export const SECTION_LABEL = "text-xs font-bold text-slate-800 uppercase tracking-wider";

// ---------------------------------------------------------------------------
// Surfaces
// ---------------------------------------------------------------------------

/** A content card. */
export const CARD = "bg-white rounded-xl border border-slate-200/90 shadow-2xs";

/** The header band inside a card. */
export const CARD_HEADER = "p-4 sm:p-5 border-b border-slate-100";

/** A table's header row. */
export const TABLE_HEAD =
  "bg-slate-50/75 border-b border-slate-100 text-slate-600 uppercase text-[10px] tracking-wider font-semibold";

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

export const BUTTON_PRIMARY =
  "px-3 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs transition-colors";

export const BUTTON_SECONDARY =
  "px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg shadow-xs transition-colors";

/** The pill beside a page title - "Active Cycle", "Pending Approval". */
export const STATUS_PILL =
  "inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold border";
