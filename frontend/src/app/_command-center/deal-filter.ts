/**
 * The three states of the Recent Deals filter.
 *
 * It lives in its own file because three different sections drive it: the KPI
 * strip, the pipeline stage cards and the filter tabs above the table itself.
 * In the source screen they all called one global `filterTable(type)`; here the
 * state sits on the page and each section is handed a setter.
 */
export type DealFilter = "all" | "action" | "draft";

/** The wording the original toast used for each filter. */
export const DEAL_FILTER_LABELS: Record<DealFilter, string> = {
  all: "All records",
  action: "Action needed",
  draft: "Drafts",
};
