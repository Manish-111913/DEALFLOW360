import { Prisma } from "./generated/prisma/client";
import { appendAudit } from "./audit";
import { currentBusinessTime } from "./clock";
import { prisma } from "./db";
import { ValidationError } from "./errors";

/**
 * Admin-editable configuration.
 *
 * The test for belonging here is: "would a deployment reasonably need this
 * different, without a code change?" Currency and its precision, document
 * number formats, the target margin — yes. Arithmetic (a percent is /100) and
 * the role capability matrix — no: those belong in code, where they are
 * reviewed and tested rather than misconfigured.
 *
 * Every key has a default, so an empty table is a working system. A missing
 * settings row must never be the reason a quotation cannot be priced.
 */

const Decimal = Prisma.Decimal;

export const SETTING_KEYS = {
  currencyCode: "currency.code",
  currencyMinorUnits: "currency.minorUnits",
  quoteNumberPrefix: "quotation.numberPrefix",
  quoteNumberPadding: "quotation.numberPadding",
  targetMarginPercentage: "margin.targetPercentage",
  discountFallbackCeiling: "discount.fallbackCeiling",
  upsellMinCoPurchaseSample: "upsell.minCoPurchaseSample",
  invoiceNumberPrefix: "invoice.numberPrefix",
  creditNoteNumberPrefix: "creditNote.numberPrefix",
  billingPeriodsAhead: "billing.periodsAhead",

  // Fulfilment. These are what the Settings screen's "Fulfillment Preferences"
  // actually change - each one is read by the allocator or the replenishment
  // report, so switching it changes what the application does rather than
  // storing a preference nobody consults.
  fulfilmentRanking: "fulfilment.ranking",
  fulfilmentBackorders: "fulfilment.backordersEnabled",
  fulfilmentReorderLevel: "fulfilment.defaultReorderLevel",
  fulfilmentReorderQuantity: "fulfilment.defaultReorderQuantity",

  // Upsell. The engine already weights history, margin and promotion; these
  // turn two of those inputs off and raise the margin floor company-wide.
  upsellUseHistory: "upsell.useHistory",
  upsellUsePromoted: "upsell.usePromoted",
  upsellMinMargin: "upsell.minMarginPercentage",

  // Reporting defaults, applied by runSalesReport when a filter is omitted.
  reportingDefaultPeriodDays: "reporting.defaultPeriodDays",
  reportingDefaultStates: "reporting.defaultApprovalStates",
} as const;

export type SettingKey = (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS];

export const SETTING_DEFAULTS: Record<SettingKey, string> = {
  [SETTING_KEYS.currencyCode]: "INR",
  // Most currencies use 2. JPY uses 0, KWD uses 3 — which is exactly why this
  // is configuration rather than a constant inside the margin engine.
  [SETTING_KEYS.currencyMinorUnits]: "2",
  [SETTING_KEYS.quoteNumberPrefix]: "Q",
  [SETTING_KEYS.quoteNumberPadding]: "4",
  // 03_BUSINESS_RULES.md: "a configured target (default 30%, set per company)".
  [SETTING_KEYS.targetMarginPercentage]: "30",
  // D10's last resort. Zero on purpose: if neither a category policy nor a tier
  // default exists, every discount reads as a violation and a human is asked.
  // Failing loud beats silently approving an unchecked discount.
  [SETTING_KEYS.discountFallbackCeiling]: "0",
  // A pairing seen in a single order would otherwise claim a 100%
  // co-purchase rate and outrank every genuine one.
  [SETTING_KEYS.upsellMinCoPurchaseSample]: "5",
  [SETTING_KEYS.invoiceNumberPrefix]: "INV",
  [SETTING_KEYS.creditNoteNumberPrefix]: "CN",
  // How many future periods a new subscription materialises. Long enough to
  // show a year of a monthly plan; a yearly plan needs far fewer rows.
  [SETTING_KEYS.billingPeriodsAhead]: "12",

  // D9's rule as written: "minimise the number of shipments", with freight as
  // the tie-break. A company that pays more for a split than it saves in
  // handling sets COST_FIRST instead.
  [SETTING_KEYS.fulfilmentRanking]: "SHIPMENTS_FIRST",
  [SETTING_KEYS.fulfilmentBackorders]: "true",
  // Zero means "no company-wide reorder point"; a stock row's own level still
  // applies. Setting it makes every row without one start reporting.
  [SETTING_KEYS.fulfilmentReorderLevel]: "0",
  [SETTING_KEYS.fulfilmentReorderQuantity]: "0",

  [SETTING_KEYS.upsellUseHistory]: "true",
  [SETTING_KEYS.upsellUsePromoted]: "true",
  // A floor on top of each pairing's own. Zero leaves pairings in charge.
  [SETTING_KEYS.upsellMinMargin]: "0",

  [SETTING_KEYS.reportingDefaultPeriodDays]: "90",
  // Empty means every state. A comma-separated list narrows it.
  [SETTING_KEYS.reportingDefaultStates]: "",
};

export const SETTING_DESCRIPTIONS: Record<SettingKey, string> = {
  [SETTING_KEYS.currencyCode]: "ISO code shown alongside monetary amounts.",
  [SETTING_KEYS.currencyMinorUnits]:
    "Decimal places money is rounded to (INR and USD 2, JPY 0, KWD 3).",
  [SETTING_KEYS.quoteNumberPrefix]: "Prefix for generated quotation numbers.",
  [SETTING_KEYS.quoteNumberPadding]:
    "Digits the sequence in a quotation number is padded to.",
  [SETTING_KEYS.targetMarginPercentage]:
    "Target margin; the risk engine scores any shortfall against it.",
  [SETTING_KEYS.discountFallbackCeiling]:
    "Ceiling used when no category policy and no tier default exist.",
  [SETTING_KEYS.upsellMinCoPurchaseSample]:
    "Minimum orders containing a product before its pairings are trusted.",
  [SETTING_KEYS.invoiceNumberPrefix]: "Prefix for generated invoice numbers.",
  [SETTING_KEYS.creditNoteNumberPrefix]: "Prefix for generated credit note numbers.",
  [SETTING_KEYS.billingPeriodsAhead]:
    "Future billing periods written when a subscription starts.",
  [SETTING_KEYS.fulfilmentRanking]:
    "How competing allocation plans are ranked once both fill the order.",
  [SETTING_KEYS.fulfilmentBackorders]:
    "Whether unfillable quantities are recorded as backorders rather than refused.",
  [SETTING_KEYS.fulfilmentReorderLevel]:
    "Company-wide reorder point for stock rows that set none of their own.",
  [SETTING_KEYS.fulfilmentReorderQuantity]:
    "Company-wide replenishment target for stock rows that set none of their own.",
  [SETTING_KEYS.upsellUseHistory]:
    "Whether co-purchase history feeds the upsell score, or only configured rates.",
  [SETTING_KEYS.upsellUsePromoted]:
    "Whether a promoted product earns its ranking bonus.",
  [SETTING_KEYS.upsellMinMargin]:
    "Company-wide margin floor a suggestion must clear, on top of the pairing's own.",
  [SETTING_KEYS.reportingDefaultPeriodDays]:
    "How far back a sales report looks when no period is given.",
  [SETTING_KEYS.reportingDefaultStates]:
    "Approval states a sales report includes by default. Empty means all.",
};

export interface ResolvedSettings {
  currencyCode: string;
  currencyMinorUnits: number;
  quoteNumberPrefix: string;
  quoteNumberPadding: number;
  targetMarginPercentage: Prisma.Decimal;
  discountFallbackCeiling: Prisma.Decimal;
  upsellMinCoPurchaseSample: number;
  invoiceNumberPrefix: string;
  creditNoteNumberPrefix: string;
  billingPeriodsAhead: number;
  fulfilmentRanking: FulfilmentRanking;
  fulfilmentBackorders: boolean;
  fulfilmentReorderLevel: number;
  fulfilmentReorderQuantity: number;
  upsellUseHistory: boolean;
  upsellUsePromoted: boolean;
  upsellMinMargin: Prisma.Decimal;
  reportingDefaultPeriodDays: number;
  reportingDefaultStates: string[];
}

/** How the allocator breaks a tie between plans that both fill the order. */
export type FulfilmentRanking = "SHIPMENTS_FIRST" | "COST_FIRST";
export const FULFILMENT_RANKINGS: FulfilmentRanking[] = ["SHIPMENTS_FIRST", "COST_FIRST"];

/**
 * In-process cache, loaded on first use and updated on write.
 *
 * Single-process by assumption, which matches how this is deployed. A second
 * server instance would need a refresh on a timer or a notify channel; that is
 * deliberately not built, because it is not needed yet.
 */
let cache: Map<string, string> | null = null;
let loadedAtMs = 0;

/**
 * How long a loaded snapshot is trusted before it is re-read.
 *
 * The cache used to be loaded once and only ever updated by this process's own
 * writes, which was correct while there was one server. There are now two - the
 * internal workspace and the customer portal are separate Next processes over
 * one database - and a third writer would be a script. A setting changed on one
 * would have gone unnoticed by the others until they restarted, so the Settings
 * screen would appear to work and quietly not apply.
 *
 * A short window rather than a notify channel: SystemSetting is ten rows, the
 * re-read is trivial, and a few seconds of staleness on a configuration change
 * is not something anyone can perceive. `setSetting` still updates its own
 * process instantly, so the person making the change sees it immediately.
 */
const CACHE_TTL_MS = 5_000;

/**
 * Monotonic elapsed time, not a clock reading.
 *
 * D3 puts business time on the server so the demo can time-travel, and a cache
 * that expired against business time would never expire while the clock was
 * held still - or expire instantly when it jumped. `performance.now()` measures
 * elapsed real time and cannot be travelled, which is exactly what a TTL needs.
 */
function elapsedMs(): number {
  return performance.now();
}

export async function refreshSettings(): Promise<void> {
  const rows = await prisma.systemSetting.findMany();
  cache = new Map(rows.map((r) => [r.key, r.value]));
  loadedAtMs = elapsedMs();
}

async function ensureCache(): Promise<Map<string, string>> {
  if (!cache || elapsedMs() - loadedAtMs > CACHE_TTL_MS) await refreshSettings();
  return cache as Map<string, string>;
}

function raw(map: Map<string, string>, key: SettingKey): string {
  return map.get(key) ?? SETTING_DEFAULTS[key];
}

export async function getSettings(): Promise<ResolvedSettings> {
  const map = await ensureCache();
  return {
    currencyCode: raw(map, SETTING_KEYS.currencyCode),
    currencyMinorUnits: Number(raw(map, SETTING_KEYS.currencyMinorUnits)),
    quoteNumberPrefix: raw(map, SETTING_KEYS.quoteNumberPrefix),
    quoteNumberPadding: Number(raw(map, SETTING_KEYS.quoteNumberPadding)),
    targetMarginPercentage: new Decimal(raw(map, SETTING_KEYS.targetMarginPercentage)),
    discountFallbackCeiling: new Decimal(raw(map, SETTING_KEYS.discountFallbackCeiling)),
    upsellMinCoPurchaseSample: Number(raw(map, SETTING_KEYS.upsellMinCoPurchaseSample)),
    invoiceNumberPrefix: raw(map, SETTING_KEYS.invoiceNumberPrefix),
    creditNoteNumberPrefix: raw(map, SETTING_KEYS.creditNoteNumberPrefix),
    billingPeriodsAhead: Number(raw(map, SETTING_KEYS.billingPeriodsAhead)),
    fulfilmentRanking: raw(map, SETTING_KEYS.fulfilmentRanking) as FulfilmentRanking,
    fulfilmentBackorders: raw(map, SETTING_KEYS.fulfilmentBackorders) === "true",
    fulfilmentReorderLevel: Number(raw(map, SETTING_KEYS.fulfilmentReorderLevel)),
    fulfilmentReorderQuantity: Number(raw(map, SETTING_KEYS.fulfilmentReorderQuantity)),
    upsellUseHistory: raw(map, SETTING_KEYS.upsellUseHistory) === "true",
    upsellUsePromoted: raw(map, SETTING_KEYS.upsellUsePromoted) === "true",
    upsellMinMargin: new Decimal(raw(map, SETTING_KEYS.upsellMinMargin)),
    reportingDefaultStates: raw(map, SETTING_KEYS.reportingDefaultStates)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    reportingDefaultPeriodDays: Number(raw(map, SETTING_KEYS.reportingDefaultPeriodDays)),
  };
}

export async function getSetting(key: SettingKey): Promise<string> {
  return raw(await ensureCache(), key);
}

/** Validated on write, so a bad value can never reach the engines. */
function validate(key: SettingKey, value: string): void {
  switch (key) {
    case SETTING_KEYS.currencyCode:
      if (!/^[A-Z]{3}$/.test(value)) {
        throw new ValidationError("Currency must be a three-letter ISO code.", key);
      }
      return;
    case SETTING_KEYS.currencyMinorUnits: {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 0 || n > 4) {
        throw new ValidationError("Minor units must be a whole number from 0 to 4.", key);
      }
      return;
    }
    case SETTING_KEYS.billingPeriodsAhead: {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 1 || n > 120) {
        throw new ValidationError("Periods ahead must be a whole number from 1 to 120.", key);
      }
      return;
    }
    case SETTING_KEYS.upsellMinCoPurchaseSample: {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 1 || n > 1000) {
        throw new ValidationError("Minimum sample must be a whole number from 1 to 1000.", key);
      }
      return;
    }
    case SETTING_KEYS.quoteNumberPadding: {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 1 || n > 10) {
        throw new ValidationError("Padding must be a whole number from 1 to 10.", key);
      }
      return;
    }
    case SETTING_KEYS.invoiceNumberPrefix:
    case SETTING_KEYS.creditNoteNumberPrefix:
    case SETTING_KEYS.quoteNumberPrefix:
      if (!/^[A-Za-z0-9-]{1,8}$/.test(value)) {
        throw new ValidationError("Prefix must be 1 to 8 letters, digits or hyphens.", key);
      }
      return;
    case SETTING_KEYS.fulfilmentRanking:
      if (!(FULFILMENT_RANKINGS as string[]).includes(value)) {
        throw new ValidationError(
          `Ranking must be one of ${FULFILMENT_RANKINGS.join(", ")}.`,
          key,
        );
      }
      return;
    case SETTING_KEYS.fulfilmentBackorders:
    case SETTING_KEYS.upsellUseHistory:
    case SETTING_KEYS.upsellUsePromoted:
      if (value !== "true" && value !== "false") {
        throw new ValidationError("Value must be true or false.", key);
      }
      return;
    case SETTING_KEYS.fulfilmentReorderLevel:
    case SETTING_KEYS.fulfilmentReorderQuantity: {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 0 || n > 1_000_000) {
        throw new ValidationError("Value must be a whole number of units.", key);
      }
      return;
    }
    case SETTING_KEYS.reportingDefaultPeriodDays: {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 1 || n > 3650) {
        throw new ValidationError("Period must be between 1 and 3650 days.", key);
      }
      return;
    }
    case SETTING_KEYS.reportingDefaultStates: {
      const allowed = ["NONE", "PENDING_MANAGER", "PENDING_FINANCE", "APPROVED", "REJECTED"];
      const states = value.split(",").map((v) => v.trim()).filter(Boolean);
      const unknown = states.filter((v) => !allowed.includes(v));
      if (unknown.length > 0) {
        throw new ValidationError(`Unknown approval state: ${unknown.join(", ")}.`, key);
      }
      return;
    }
    case SETTING_KEYS.upsellMinMargin:
    case SETTING_KEYS.targetMarginPercentage:
    case SETTING_KEYS.discountFallbackCeiling: {
      const n = new Decimal(value);
      if (n.isNaN() || n.lessThan(0) || n.greaterThan(100)) {
        throw new ValidationError("Value must be a percentage between 0 and 100.", key);
      }
      return;
    }
    default:
      throw new ValidationError(`Unknown setting ${key}`, "key");
  }
}

/** Audited: a settings change alters how every later calculation behaves. */
export async function setSetting(params: {
  key: SettingKey;
  value: string;
  actorId?: string | null;
  reason?: string;
}): Promise<void> {
  validate(params.key, params.value);

  const map = await ensureCache();
  const before = map.get(params.key) ?? null;
  const now = currentBusinessTime();

  await prisma.systemSetting.upsert({
    where: { key: params.key },
    create: {
      key: params.key,
      value: params.value,
      description: SETTING_DESCRIPTIONS[params.key],
      updatedAt: now,
      updatedBy: params.actorId ?? null,
    },
    update: { value: params.value, updatedAt: now, updatedBy: params.actorId ?? null },
  });

  map.set(params.key, params.value);

  await appendAudit({
    entityName: "SystemSetting",
    entityId: params.key,
    action: "CONFIGURE",
    actorId: params.actorId ?? null,
    reason: params.reason ?? `Setting ${params.key} changed`,
    fieldChanges: {
      value: { before: before ?? SETTING_DEFAULTS[params.key], after: params.value },
    },
  });
}

/** Write any default that is missing. Used by the seed. */
export async function ensureDefaultSettings(actorId?: string | null): Promise<number> {
  const now = currentBusinessTime();
  let written = 0;

  for (const key of Object.values(SETTING_KEYS)) {
    const existing = await prisma.systemSetting.findUnique({ where: { key } });
    if (existing) continue;
    await prisma.systemSetting.create({
      data: {
        key,
        value: SETTING_DEFAULTS[key],
        description: SETTING_DESCRIPTIONS[key],
        updatedAt: now,
        updatedBy: actorId ?? null,
      },
    });
    written += 1;
  }

  await refreshSettings();
  return written;
}

/** Test helper: drop the cache so the next read hits the database. */
export function __clearSettingsCacheForTests(): void {
  cache = null;
  loadedAtMs = 0;
}
