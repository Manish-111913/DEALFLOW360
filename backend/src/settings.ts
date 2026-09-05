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
};

export interface ResolvedSettings {
  currencyCode: string;
  currencyMinorUnits: number;
  quoteNumberPrefix: string;
  quoteNumberPadding: number;
  targetMarginPercentage: Prisma.Decimal;
}

/**
 * In-process cache, loaded on first use and updated on write.
 *
 * Single-process by assumption, which matches how this is deployed. A second
 * server instance would need a refresh on a timer or a notify channel; that is
 * deliberately not built, because it is not needed yet.
 */
let cache: Map<string, string> | null = null;

export async function refreshSettings(): Promise<void> {
  const rows = await prisma.systemSetting.findMany();
  cache = new Map(rows.map((r) => [r.key, r.value]));
}

async function ensureCache(): Promise<Map<string, string>> {
  if (!cache) await refreshSettings();
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
    case SETTING_KEYS.quoteNumberPadding: {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 1 || n > 10) {
        throw new ValidationError("Padding must be a whole number from 1 to 10.", key);
      }
      return;
    }
    case SETTING_KEYS.quoteNumberPrefix:
      if (!/^[A-Za-z0-9-]{1,8}$/.test(value)) {
        throw new ValidationError("Prefix must be 1 to 8 letters, digits or hyphens.", key);
      }
      return;
    case SETTING_KEYS.targetMarginPercentage: {
      const n = new Decimal(value);
      if (n.isNaN() || n.lessThan(0) || n.greaterThan(100)) {
        throw new ValidationError("Target margin must be between 0 and 100.", key);
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
}
