import { Prisma } from "../generated/prisma/client";
import type { CustomerTier, Role } from "../generated/prisma/enums";
import { appendAudit } from "../audit";
import { assertCan, ForbiddenError, type AuthzUser, type ConfigSubject } from "../authz/roles";
import { currentBusinessTime } from "../clock";
import { prisma } from "../db";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import {
  refreshSettings,
  setSetting,
  SETTING_DEFAULTS,
  SETTING_KEYS,
  type SettingKey,
} from "../settings";

/**
 * Writing configuration.
 *
 * `configuration.ts` could already read every part of this - the catalogue, the
 * ceilings, the approval chain, the warehouses, the pairings - and its header
 * says writes "stay in the module that owns the rule". The problem was that no
 * module owned them: outside `setSetting` there was not a single create or
 * update against any configuration model anywhere in the application, so the
 * only way to change a discount ceiling or a warehouse priority was to edit the
 * seed and re-run it.
 *
 * This is that missing half. Every function asks `can(user, "configure", ...)`
 * for the subject it touches, which is where D16 lands: a Sales Manager owns
 * discount tiers and the approval chain, an Admin owns the rest. Every write is
 * audited, because each one silently changes how later quotations are priced,
 * routed and shipped.
 */

const Decimal = Prisma.Decimal;

function assertConfigurable(user: AuthzUser, subject: ConfigSubject): void {
  assertCan(user, "configure", subject);
}

/** A percentage that a ceiling or floor can actually be. */
function percentage(value: string, field: string): Prisma.Decimal {
  const parsed = new Decimal(value);
  if (parsed.isNaN() || parsed.lessThan(0) || parsed.greaterThan(100)) {
    throw new ValidationError("Value must be a percentage between 0 and 100.", field);
  }
  return parsed;
}

/** Money, kept as a Decimal from the string it arrived as. */
function money(value: string, field: string): Prisma.Decimal {
  if (!/^\d+(\.\d{1,2})?$/.test(value)) {
    throw new ValidationError("Amount must be a positive figure with at most two decimals.", field);
  }
  return new Decimal(value);
}

async function audit(params: {
  entityName: string;
  entityId: string;
  user: AuthzUser;
  reason: string;
  fieldChanges: Record<string, unknown>;
}): Promise<void> {
  await appendAudit({
    entityName: params.entityName,
    entityId: params.entityId,
    action: "CONFIGURE",
    actorId: params.user.id,
    reason: params.reason,
    fieldChanges: params.fieldChanges,
  });
}

// ---------------------------------------------------------------------------
// Discount ceilings (D16: the Sales Manager's, not only the Admin's)
// ---------------------------------------------------------------------------

/**
 * Set a customer tier's default ceiling.
 *
 * This is the number every quotation for that tier is checked against when no
 * category override applies, so changing it changes which future deals need
 * approval. Existing quotations are not re-checked: their approval state
 * records the decision that was actually taken, and rewriting history to match
 * a new policy would make the audit trail a lie.
 */
export async function setTierCeiling(
  user: AuthzUser,
  input: { tier: CustomerTier; maxDiscount: string; isActive?: boolean },
) {
  assertConfigurable(user, "discountTier");

  const maxDiscount = percentage(input.maxDiscount, "maxDiscount");
  const now = currentBusinessTime();
  const before = await prisma.discountTier.findUnique({ where: { tier: input.tier } });

  const row = await prisma.discountTier.upsert({
    where: { tier: input.tier },
    create: {
      tier: input.tier,
      defaultMaxDiscount: maxDiscount,
      isActive: input.isActive ?? true,
      createdAt: now,
      updatedAt: now,
    },
    update: {
      defaultMaxDiscount: maxDiscount,
      ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
      updatedAt: now,
    },
  });

  await audit({
    entityName: "DiscountTier",
    entityId: row.id,
    user,
    reason: `${input.tier} default ceiling set to ${maxDiscount.toFixed(2)}%`,
    fieldChanges: {
      defaultMaxDiscount: {
        before: before?.defaultMaxDiscount.toFixed(2) ?? null,
        after: maxDiscount.toFixed(2),
      },
    },
  });

  return row;
}

/**
 * Set a category's ceiling for one tier, which overrides that tier's default.
 *
 * Uniqueness over active rows is a partial index, and the documented workflow is
 * deactivate-then-replace rather than update-in-place - so an existing active
 * row for the same pair is retired first and a fresh one written, leaving the
 * old ceiling visible in history rather than overwritten.
 */
export async function setCategoryCeiling(
  user: AuthzUser,
  input: { tier: CustomerTier; categoryId: string; maxDiscount: string },
) {
  assertConfigurable(user, "discountTier");

  const maxDiscount = percentage(input.maxDiscount, "maxDiscount");
  const now = currentBusinessTime();

  const category = await prisma.productCategory.findUnique({
    where: { id: input.categoryId },
    select: { id: true, name: true },
  });
  if (!category) throw new NotFoundError(`Category ${input.categoryId} does not exist`);

  const existing = await prisma.discountPolicy.findFirst({
    where: { tier: input.tier, categoryId: input.categoryId, isActive: true },
  });

  const row = await prisma.$transaction(async (tx) => {
    if (existing) {
      await tx.discountPolicy.update({
        where: { id: existing.id },
        data: { isActive: false, effectiveTo: now, updatedAt: now },
      });
    }
    return tx.discountPolicy.create({
      data: {
        tier: input.tier,
        categoryId: input.categoryId,
        maxDiscount,
        isActive: true,
        effectiveFrom: now,
        createdAt: now,
        updatedAt: now,
      },
    });
  });

  await audit({
    entityName: "DiscountPolicy",
    entityId: row.id,
    user,
    reason: `${input.tier} ceiling for ${category.name} set to ${maxDiscount.toFixed(2)}%`,
    fieldChanges: {
      maxDiscount: {
        before: existing?.maxDiscount.toFixed(2) ?? null,
        after: maxDiscount.toFixed(2),
      },
      supersededPolicyId: existing?.id ?? null,
    },
  });

  return row;
}

/** Retire a category override, so the tier default applies again. */
export async function removeCategoryCeiling(user: AuthzUser, policyId: string) {
  assertConfigurable(user, "discountTier");

  const now = currentBusinessTime();
  const existing = await prisma.discountPolicy.findUnique({
    where: { id: policyId },
    include: { category: { select: { name: true } } },
  });
  if (!existing || !existing.isActive) {
    throw new NotFoundError("That discount override is not active.");
  }

  await prisma.discountPolicy.update({
    where: { id: policyId },
    data: { isActive: false, effectiveTo: now, updatedAt: now },
  });

  await audit({
    entityName: "DiscountPolicy",
    entityId: policyId,
    user,
    reason: `${existing.tier} override for ${existing.category.name} retired`,
    fieldChanges: { isActive: { before: true, after: false } },
  });
}

// ---------------------------------------------------------------------------
// Approval routing (D16, D11)
// ---------------------------------------------------------------------------

/**
 * Change the discount band that sends a quotation to a given approver.
 *
 * D11 says the chain is configured, not hardcoded at 30/60. This is that
 * configuration, and it is the sharpest control on this screen: widening a band
 * means deals that would have needed a reviewer now go straight out.
 */
export async function setApprovalStep(
  user: AuthzUser,
  input: {
    stepId: string;
    minDiscount?: string | null;
    maxDiscount?: string | null;
    minRiskScore?: string | null;
    maxRiskScore?: string | null;
  },
) {
  assertConfigurable(user, "approvalChain");

  const step = await prisma.approvalStep.findUnique({
    where: { id: input.stepId },
    include: { chain: { select: { name: true } } },
  });
  if (!step) throw new NotFoundError(`Approval step ${input.stepId} does not exist`);

  const bound = (value: string | null | undefined, field: string) =>
    value === undefined ? undefined : value === null || value === "" ? null : percentage(value, field);

  const minDiscount = bound(input.minDiscount, "minDiscount");
  const maxDiscount = bound(input.maxDiscount, "maxDiscount");
  const minRiskScore = bound(input.minRiskScore, "minRiskScore");
  const maxRiskScore = bound(input.maxRiskScore, "maxRiskScore");

  // An inverted band matches nothing, so the step would silently never fire.
  const lowDiscount = minDiscount ?? step.minDiscount;
  const highDiscount = maxDiscount ?? step.maxDiscount;
  if (lowDiscount && highDiscount && lowDiscount.greaterThan(highDiscount)) {
    throw new ValidationError(
      "The lower bound of a discount band cannot exceed its upper bound.",
      "minDiscount",
    );
  }

  const updated = await prisma.approvalStep.update({
    where: { id: input.stepId },
    data: {
      ...(minDiscount === undefined ? {} : { minDiscount }),
      ...(maxDiscount === undefined ? {} : { maxDiscount }),
      ...(minRiskScore === undefined ? {} : { minRiskScore }),
      ...(maxRiskScore === undefined ? {} : { maxRiskScore }),
    },
  });

  await audit({
    entityName: "ApprovalStep",
    entityId: updated.id,
    user,
    reason: `${step.chain.name} step ${step.stepOrder} (${step.approverRole}) thresholds changed`,
    fieldChanges: {
      minDiscount: {
        before: step.minDiscount?.toFixed(2) ?? null,
        after: updated.minDiscount?.toFixed(2) ?? null,
      },
      maxDiscount: {
        before: step.maxDiscount?.toFixed(2) ?? null,
        after: updated.maxDiscount?.toFixed(2) ?? null,
      },
    },
  });

  return updated;
}

/** Add a reviewer to the end of a chain. */
export async function addApprovalStep(
  user: AuthzUser,
  input: { chainId: string; approverRole: Role; minDiscount?: string | null },
) {
  assertConfigurable(user, "approvalChain");

  const chain = await prisma.approvalChain.findUnique({
    where: { id: input.chainId },
    include: { steps: { orderBy: { stepOrder: "desc" }, take: 1 } },
  });
  if (!chain) throw new NotFoundError(`Approval chain ${input.chainId} does not exist`);

  // The routing engine looks up a human holding the role, so a step assigned to
  // a role nobody holds is a step no deal can ever clear. This company runs on
  // Admin, Sales Manager and customer - Finance/Operations is not staffed, so
  // the Sales Manager is the only reviewer a chain may name.
  if (input.approverRole !== "SALES_MANAGER") {
    throw new ValidationError(
      "An approval step must be assigned to a Sales Manager.",
      "approverRole",
    );
  }

  const step = await prisma.approvalStep.create({
    data: {
      approvalChainId: input.chainId,
      stepOrder: (chain.steps[0]?.stepOrder ?? 0) + 1,
      approverRole: input.approverRole,
      minDiscount: input.minDiscount ? percentage(input.minDiscount, "minDiscount") : null,
    },
  });

  await audit({
    entityName: "ApprovalStep",
    entityId: step.id,
    user,
    reason: `${input.approverRole} added to ${chain.name} as step ${step.stepOrder}`,
    fieldChanges: { approverRole: input.approverRole, stepOrder: step.stepOrder },
  });

  return step;
}

/** Remove a reviewer. Refused while anyone is still waiting on them. */
export async function removeApprovalStep(user: AuthzUser, stepId: string) {
  assertConfigurable(user, "approvalChain");

  const step = await prisma.approvalStep.findUnique({
    where: { id: stepId },
    include: { chain: { select: { name: true } }, _count: { select: { requests: true } } },
  });
  if (!step) throw new NotFoundError(`Approval step ${stepId} does not exist`);

  const pending = await prisma.approvalRequest.count({
    where: { stepId, status: "PENDING" },
  });
  if (pending > 0) {
    throw new ConflictError(
      `${pending} quotation(s) are waiting on this step. Decide them before removing it.`,
    );
  }

  // Deleting a step whose decided requests reference it would take the history
  // with it, so a step that has ever been used is kept and simply moved out of
  // range instead.
  if (step._count.requests > 0) {
    await prisma.approvalStep.update({
      where: { id: stepId },
      data: { minDiscount: new Decimal(100), maxDiscount: new Decimal(100) },
    });
    await audit({
      entityName: "ApprovalStep",
      entityId: stepId,
      user,
      reason: `${step.approverRole} step retired from ${step.chain.name} (history preserved)`,
      fieldChanges: { retired: true, decisionsOnRecord: step._count.requests },
    });
    return;
  }

  await prisma.approvalStep.delete({ where: { id: stepId } });
  await audit({
    entityName: "ApprovalStep",
    entityId: stepId,
    user,
    reason: `${step.approverRole} step removed from ${step.chain.name}`,
    fieldChanges: { removed: true },
  });
}

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

export async function setProduct(
  user: AuthzUser,
  input: {
    productId: string;
    basePrice?: string;
    costPrice?: string;
    isActive?: boolean;
    isPromoted?: boolean;
  },
) {
  assertConfigurable(user, "product");

  const before = await prisma.product.findUnique({ where: { id: input.productId } });
  if (!before) throw new NotFoundError(`Product ${input.productId} does not exist`);

  const basePrice = input.basePrice === undefined ? undefined : money(input.basePrice, "basePrice");
  const costPrice = input.costPrice === undefined ? undefined : money(input.costPrice, "costPrice");

  // A product that costs more than it sells for prices every future line at a
  // negative margin, which the risk engine would then flag on deal after deal.
  const finalPrice = basePrice ?? before.basePrice;
  const finalCost = costPrice ?? before.costPrice;
  if (finalCost.greaterThan(finalPrice)) {
    throw new ValidationError(
      "Cost price cannot exceed the standard price — every line would price at a loss.",
      "costPrice",
    );
  }

  const product = await prisma.product.update({
    where: { id: input.productId },
    data: {
      ...(basePrice === undefined ? {} : { basePrice }),
      ...(costPrice === undefined ? {} : { costPrice }),
      ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
      ...(input.isPromoted === undefined ? {} : { isPromoted: input.isPromoted }),
      updatedAt: currentBusinessTime(),
    },
  });

  await audit({
    entityName: "Product",
    entityId: product.id,
    user,
    reason: `${product.name} updated`,
    fieldChanges: {
      basePrice: { before: before.basePrice.toFixed(2), after: product.basePrice.toFixed(2) },
      costPrice: { before: before.costPrice.toFixed(2), after: product.costPrice.toFixed(2) },
      isActive: { before: before.isActive, after: product.isActive },
      isPromoted: { before: before.isPromoted, after: product.isPromoted },
    },
  });

  return product;
}

export async function setPriceListActive(
  user: AuthzUser,
  input: { priceListId: string; isActive: boolean },
) {
  assertConfigurable(user, "priceList");

  const before = await prisma.priceList.findUnique({ where: { id: input.priceListId } });
  if (!before) throw new NotFoundError(`Price list ${input.priceListId} does not exist`);

  const list = await prisma.priceList.update({
    where: { id: input.priceListId },
    data: { isActive: input.isActive, updatedAt: currentBusinessTime() },
  });

  await audit({
    entityName: "PriceList",
    entityId: list.id,
    user,
    reason: `${list.name} ${input.isActive ? "activated" : "deactivated"}`,
    fieldChanges: { isActive: { before: before.isActive, after: list.isActive } },
  });

  return list;
}

// ---------------------------------------------------------------------------
// Warehouses
// ---------------------------------------------------------------------------

/**
 * Change a depot's priority, freight or availability.
 *
 * Priority is the order the allocator's priority-walk candidate fills from, and
 * freight is what the cost tie-break compares - so both genuinely change which
 * plan comes back, not merely how it is described.
 */
export async function setWarehouse(
  user: AuthzUser,
  input: {
    warehouseId: string;
    priority?: number;
    shippingCost?: string;
    isActive?: boolean;
  },
) {
  assertConfigurable(user, "warehouse");

  const before = await prisma.warehouse.findUnique({ where: { id: input.warehouseId } });
  if (!before) throw new NotFoundError(`Warehouse ${input.warehouseId} does not exist`);

  if (input.priority !== undefined && (!Number.isInteger(input.priority) || input.priority < 0)) {
    throw new ValidationError("Priority must be a whole number, lowest first.", "priority");
  }

  // Deactivating the last active depot leaves the allocator nothing to plan
  // with, and every later order would fail with an unhelpful empty plan.
  if (input.isActive === false && before.isActive) {
    const remaining = await prisma.warehouse.count({
      where: { isActive: true, id: { not: input.warehouseId } },
    });
    if (remaining === 0) {
      throw new ConflictError(
        "This is the last active warehouse — deactivating it would leave nothing to ship from.",
      );
    }
  }

  const warehouse = await prisma.warehouse.update({
    where: { id: input.warehouseId },
    data: {
      ...(input.priority === undefined ? {} : { priority: input.priority }),
      ...(input.shippingCost === undefined
        ? {}
        : { shippingCost: money(input.shippingCost, "shippingCost") }),
      ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
      updatedAt: currentBusinessTime(),
    },
  });

  await audit({
    entityName: "Warehouse",
    entityId: warehouse.id,
    user,
    reason: `${warehouse.name} updated`,
    fieldChanges: {
      priority: { before: before.priority, after: warehouse.priority },
      shippingCost: {
        before: before.shippingCost.toFixed(2),
        after: warehouse.shippingCost.toFixed(2),
      },
      isActive: { before: before.isActive, after: warehouse.isActive },
    },
  });

  return warehouse;
}

// ---------------------------------------------------------------------------
// Subscriptions and upsell
// ---------------------------------------------------------------------------

const PRORATION_RULES = ["DAILY_CALENDAR", "NONE"] as const;
const CANCELLATION_RULES = ["PRORATA_CREDIT", "END_OF_CYCLE", "IMMEDIATE_NO_CREDIT"] as const;

export async function setSubscriptionPlan(
  user: AuthzUser,
  input: {
    planId: string;
    prorationRule?: string;
    cancellationRule?: string;
    isActive?: boolean;
  },
) {
  assertConfigurable(user, "subscriptionPlan");

  const before = await prisma.subscriptionPlan.findUnique({ where: { id: input.planId } });
  if (!before) throw new NotFoundError(`Plan ${input.planId} does not exist`);

  if (input.prorationRule && !(PRORATION_RULES as readonly string[]).includes(input.prorationRule)) {
    throw new ValidationError(
      `Proration must be one of ${PRORATION_RULES.join(", ")}.`,
      "prorationRule",
    );
  }
  if (
    input.cancellationRule &&
    !(CANCELLATION_RULES as readonly string[]).includes(input.cancellationRule)
  ) {
    throw new ValidationError(
      `Cancellation must be one of ${CANCELLATION_RULES.join(", ")}.`,
      "cancellationRule",
    );
  }

  const plan = await prisma.subscriptionPlan.update({
    where: { id: input.planId },
    data: {
      ...(input.prorationRule ? { prorationRule: input.prorationRule } : {}),
      ...(input.cancellationRule ? { cancellationRule: input.cancellationRule } : {}),
      ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
      updatedAt: currentBusinessTime(),
    },
  });

  await audit({
    entityName: "SubscriptionPlan",
    entityId: plan.id,
    user,
    reason: `${plan.name} rules updated`,
    fieldChanges: {
      prorationRule: { before: before.prorationRule, after: plan.prorationRule },
      cancellationRule: { before: before.cancellationRule, after: plan.cancellationRule },
      isActive: { before: before.isActive, after: plan.isActive },
    },
  });

  return plan;
}

export async function setUpsellRule(
  user: AuthzUser,
  input: {
    pairingId: string;
    minMarginPercentage?: string;
    configuredRate?: string | null;
    isActive?: boolean;
  },
) {
  assertConfigurable(user, "upsellRule");

  const before = await prisma.productPairing.findUnique({
    where: { id: input.pairingId },
    include: {
      baseProduct: { select: { name: true } },
      suggestedProduct: { select: { name: true } },
    },
  });
  if (!before) throw new NotFoundError(`Pairing ${input.pairingId} does not exist`);

  let configuredRate: Prisma.Decimal | null | undefined;
  if (input.configuredRate !== undefined) {
    if (input.configuredRate === null || input.configuredRate === "") {
      // Cleared, so the derived co-purchase rate takes over again.
      configuredRate = null;
    } else {
      const parsed = new Decimal(input.configuredRate);
      if (parsed.isNaN() || parsed.lessThan(0) || parsed.greaterThan(1)) {
        throw new ValidationError("A co-purchase rate is a fraction from 0 to 1.", "configuredRate");
      }
      configuredRate = parsed;
    }
  }

  const pairing = await prisma.productPairing.update({
    where: { id: input.pairingId },
    data: {
      ...(input.minMarginPercentage === undefined
        ? {}
        : { minMarginPercentage: percentage(input.minMarginPercentage, "minMarginPercentage") }),
      ...(configuredRate === undefined ? {} : { configuredRate }),
      ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
      updatedAt: currentBusinessTime(),
    },
  });

  await audit({
    entityName: "ProductPairing",
    entityId: pairing.id,
    user,
    reason: `${before.baseProduct.name} → ${before.suggestedProduct.name} pairing updated`,
    fieldChanges: {
      minMarginPercentage: {
        before: before.minMarginPercentage.toFixed(2),
        after: pairing.minMarginPercentage.toFixed(2),
      },
      configuredRate: {
        before: before.configuredRate?.toFixed(4) ?? null,
        after: pairing.configuredRate?.toFixed(4) ?? null,
      },
      isActive: { before: before.isActive, after: pairing.isActive },
    },
  });

  return pairing;
}

// ---------------------------------------------------------------------------
// System settings
// ---------------------------------------------------------------------------

/**
 * Who may change a system setting.
 *
 * The capability matrix has no subject for these - they predate the product
 * having a screen for them - and they are genuinely company-wide: currency,
 * the target margin every risk score is measured against, the fallback ceiling
 * used when no policy matches. Rather than quietly folding them into one of the
 * existing `configure` subjects, the rule is written out: Admin only.
 */
function assertMaySetSystemSetting(user: AuthzUser): void {
  if (user.kind !== "INTERNAL" || user.role !== "ADMIN") {
    throw new ForbiddenError("System settings are an administrator's to change.");
  }
}

export async function updateSetting(
  user: AuthzUser,
  input: { key: string; value: string; reason?: string },
) {
  assertMaySetSystemSetting(user);

  const keys = Object.values(SETTING_KEYS) as string[];
  if (!keys.includes(input.key)) {
    throw new ValidationError(`Unknown setting ${input.key}`, "key");
  }

  // setSetting validates the value for the key and audits the change.
  await setSetting({
    key: input.key as SettingKey,
    value: input.value,
    actorId: user.id,
    reason: input.reason ?? `Setting ${input.key} changed from Settings`,
  });

  return { key: input.key, value: input.value };
}

/** Put one setting back to what it ships as. */
export async function resetSetting(user: AuthzUser, key: string) {
  assertMaySetSystemSetting(user);

  const keys = Object.values(SETTING_KEYS) as string[];
  if (!keys.includes(key)) throw new ValidationError(`Unknown setting ${key}`, "key");

  const fallback = SETTING_DEFAULTS[key as SettingKey];
  await setSetting({
    key: key as SettingKey,
    value: fallback,
    actorId: user.id,
    reason: `Setting ${key} reset to its default`,
  });
  await refreshSettings();

  return { key, value: fallback };
}
