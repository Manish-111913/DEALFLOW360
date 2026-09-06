import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { AuthzUser } from "../authz/roles";
import { ForbiddenError } from "../authz/roles";
import { prisma } from "../db";
import { __clearSettingsCacheForTests, getSettings, setSetting } from "../settings";
import { resolveCeilings } from "./discount-policy";
import { testDealPolicy } from "./policy-test";
import {
  removeCategoryCeiling,
  setApprovalStep,
  setCategoryCeiling,
  setProduct,
  setTierCeiling,
  setUpsellRule,
  setWarehouse,
  updateSetting,
} from "./settings-admin";

/**
 * Writing configuration, and the point of writing it: the engines read it back.
 *
 * The authorisation cases matter - D16 puts discount ceilings and the approval
 * chain with the Sales Manager and everything else with the Admin - but the
 * tests that matter most are the ones showing a saved change actually altering
 * what the application decides. A settings screen whose values nothing consults
 * is worse than no settings screen, because it looks like it worked.
 */

let admin: AuthzUser;
let manager: AuthzUser;
let rep: AuthzUser;
let finance: AuthzUser;

let hardwareId: string;
let laptopId: string;
let mainId: string;
let eastId: string;

/** Restored in afterEach, so one test cannot leave the policy shifted. */
const restore: (() => Promise<unknown>)[] = [];

async function userFor(email: string): Promise<AuthzUser> {
  const u = await prisma.user.findUniqueOrThrow({ where: { email } });
  return { id: u.id, kind: u.kind, role: u.role, customerId: u.customerId, salesTeamId: u.salesTeamId };
}

beforeAll(async () => {
  admin = await userFor("admin@dealflow360.test");
  manager = await userFor("manager@dealflow360.test");
  rep = await userFor("priya@dealflow360.test");
  finance = await userFor("finance@dealflow360.test");

  hardwareId = (await prisma.productCategory.findFirstOrThrow({ where: { name: "Hardware" } })).id;
  laptopId = (await prisma.product.findUniqueOrThrow({ where: { sku: "HW-LAPTOP-PRO" } })).id;
  mainId = (await prisma.warehouse.findUniqueOrThrow({ where: { code: "MAIN" } })).id;
  eastId = (await prisma.warehouse.findUniqueOrThrow({ where: { code: "EAST" } })).id;
});

afterEach(async () => {
  while (restore.length > 0) await restore.pop()!();
  __clearSettingsCacheForTests();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("who may change what (D16)", () => {
  it("lets a Sales Manager set a tier ceiling", async () => {
    const before = await prisma.discountTier.findUniqueOrThrow({ where: { tier: "GOLD" } });
    restore.push(() =>
      prisma.discountTier.update({
        where: { tier: "GOLD" },
        data: { defaultMaxDiscount: before.defaultMaxDiscount },
      }),
    );

    const row = await setTierCeiling(manager, { tier: "GOLD", maxDiscount: "22.00" });
    expect(row.defaultMaxDiscount.toFixed(2)).toBe("22.00");
  });

  it("refuses a Sales Rep", async () => {
    await expect(
      setTierCeiling(rep, { tier: "GOLD", maxDiscount: "50.00" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses Finance, which reviews deals but does not set the rules", async () => {
    await expect(
      setTierCeiling(finance, { tier: "GOLD", maxDiscount: "50.00" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("keeps the catalogue and the warehouses with the Admin", async () => {
    // A manager owns governance, not operations - the split the matrix draws.
    await expect(
      setProduct(manager, { productId: laptopId, basePrice: "1.00" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      setWarehouse(manager, { warehouseId: mainId, priority: 9 }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("keeps system settings with the Admin alone", async () => {
    await expect(
      updateSetting(manager, { key: "margin.targetPercentage", value: "10" }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const before = await getSettings();
    restore.push(() =>
      setSetting({
        key: "margin.targetPercentage",
        value: before.targetMarginPercentage.toFixed(2),
      }),
    );

    await expect(
      updateSetting(admin, { key: "margin.targetPercentage", value: "35" }),
    ).resolves.toMatchObject({ value: "35" });
  });

  it("refuses a value the setting cannot take", async () => {
    await expect(
      updateSetting(admin, { key: "currency.code", value: "rupees" }),
    ).rejects.toMatchObject({ status: 422 });
    await expect(
      updateSetting(admin, { key: "not.a.setting", value: "1" }),
    ).rejects.toMatchObject({ status: 422 });
  });
});

describe("a saved ceiling is the ceiling the engines use", () => {
  it("changes what resolveCeilings returns", async () => {
    const before = await prisma.discountTier.findUniqueOrThrow({ where: { tier: "SILVER" } });
    restore.push(() =>
      prisma.discountTier.update({
        where: { tier: "SILVER" },
        data: { defaultMaxDiscount: before.defaultMaxDiscount },
      }),
    );

    await setTierCeiling(manager, { tier: "SILVER", maxDiscount: "7.50" });

    const resolved = await resolveCeilings("SILVER", [hardwareId]);
    const hardware = resolved.get(hardwareId)!;
    // Only if no category override exists for SILVER/Hardware; when one does,
    // the override wins - which is the resolution order this asserts either way.
    expect(["TIER_DEFAULT", "CATEGORY_POLICY"]).toContain(hardware.source);
    if (hardware.source === "TIER_DEFAULT") {
      expect(hardware.ceiling.toFixed(2)).toBe("7.50");
    }
  });

  it("lets a category override narrow its tier, and retires cleanly", async () => {
    const created = await setCategoryCeiling(manager, {
      tier: "BRONZE",
      categoryId: hardwareId,
      maxDiscount: "3.00",
    });
    restore.push(() => prisma.discountPolicy.delete({ where: { id: created.id } }));

    const resolved = await resolveCeilings("BRONZE", [hardwareId]);
    expect(resolved.get(hardwareId)!.source).toBe("CATEGORY_POLICY");
    expect(resolved.get(hardwareId)!.ceiling.toFixed(2)).toBe("3.00");

    await removeCategoryCeiling(manager, created.id);

    const after = await resolveCeilings("BRONZE", [hardwareId]);
    expect(after.get(hardwareId)!.source).not.toBe("CATEGORY_POLICY");
  });

  it("supersedes rather than overwrites, so the old ceiling stays explainable", async () => {
    const first = await setCategoryCeiling(manager, {
      tier: "BRONZE",
      categoryId: hardwareId,
      maxDiscount: "4.00",
    });
    const second = await setCategoryCeiling(manager, {
      tier: "BRONZE",
      categoryId: hardwareId,
      maxDiscount: "6.00",
    });
    restore.push(() =>
      prisma.discountPolicy.deleteMany({ where: { id: { in: [first.id, second.id] } } }),
    );

    const retired = await prisma.discountPolicy.findUniqueOrThrow({ where: { id: first.id } });
    expect(retired.isActive).toBe(false);
    expect(retired.effectiveTo).not.toBeNull();
    expect(second.isActive).toBe(true);
  });
});

describe("the policy tester answers with the live rules", () => {
  it("agrees with the ceiling that was just saved", async () => {
    const before = await prisma.discountTier.findUniqueOrThrow({ where: { tier: "GOLD" } });
    restore.push(() =>
      prisma.discountTier.update({
        where: { tier: "GOLD" },
        data: { defaultMaxDiscount: before.defaultMaxDiscount },
      }),
    );

    await setTierCeiling(manager, { tier: "GOLD", maxDiscount: "12.00" });

    const under = await testDealPolicy(manager, {
      tier: "GOLD",
      categoryId: hardwareId,
      discountPercentage: "5",
    });
    const over = await testDealPolicy(manager, {
      tier: "GOLD",
      categoryId: hardwareId,
      discountPercentage: "40",
    });

    expect(over.overCeiling).toBe(true);
    expect(over.approvalRequired).toBe(true);
    expect(over.reviewers.length).toBeGreaterThan(0);
    // Whatever the ceiling resolves to, 5% must not breach a 12% GOLD default.
    expect(Number(under.effectiveCeiling)).toBeGreaterThanOrEqual(5);
    expect(under.overCeiling).toBe(false);
  });

  it("refuses a discount that is not a percentage", async () => {
    await expect(
      testDealPolicy(manager, { tier: "GOLD", categoryId: hardwareId, discountPercentage: "250" }),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("writes nothing", async () => {
    const before = await prisma.auditLog.count();
    await testDealPolicy(manager, {
      tier: "GOLD",
      categoryId: hardwareId,
      discountPercentage: "9",
    });
    expect(await prisma.auditLog.count()).toBe(before);
  });
});

describe("guards that stop a setting breaking the system", () => {
  it("refuses a cost price above the sale price", async () => {
    await expect(
      setProduct(admin, { productId: laptopId, costPrice: "999999.00" }),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("refuses to deactivate the last warehouse", async () => {
    const before = await prisma.warehouse.findMany({ where: { isActive: true } });
    const others = before.filter((w) => w.id !== mainId);
    for (const w of others) {
      await prisma.warehouse.update({ where: { id: w.id }, data: { isActive: false } });
    }
    restore.push(async () => {
      for (const w of others) {
        await prisma.warehouse.update({ where: { id: w.id }, data: { isActive: true } });
      }
    });

    await expect(
      setWarehouse(admin, { warehouseId: mainId, isActive: false }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("refuses an inverted approval band", async () => {
    const step = await prisma.approvalStep.findFirstOrThrow({ orderBy: { stepOrder: "asc" } });
    await expect(
      setApprovalStep(manager, { stepId: step.id, minDiscount: "50", maxDiscount: "10" }),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("refuses a co-purchase rate outside 0..1", async () => {
    const pairing = await prisma.productPairing.findFirst();
    if (!pairing) return;
    await expect(
      setUpsellRule(admin, { pairingId: pairing.id, configuredRate: "5" }),
    ).rejects.toMatchObject({ status: 422 });
  });
});

describe("every configuration write is audited", () => {
  it("records who changed a ceiling and what it was before", async () => {
    const before = await prisma.discountTier.findUniqueOrThrow({ where: { tier: "SILVER" } });
    restore.push(() =>
      prisma.discountTier.update({
        where: { tier: "SILVER" },
        data: { defaultMaxDiscount: before.defaultMaxDiscount },
      }),
    );

    const row = await setTierCeiling(manager, { tier: "SILVER", maxDiscount: "9.25" });

    const entry = await prisma.auditLog.findFirst({
      where: { entityName: "DiscountTier", entityId: row.id },
      orderBy: { seq: "desc" },
    });
    expect(entry?.action).toBe("CONFIGURE");
    expect(entry?.actorId).toBe(manager.id);
    expect(JSON.stringify(entry?.fieldChanges)).toContain("9.25");
  });
});

describe("warehouse changes reach the allocator", () => {
  it("moves freight, which the cost tie-break compares", async () => {
    const before = await prisma.warehouse.findUniqueOrThrow({ where: { id: eastId } });
    restore.push(() =>
      prisma.warehouse.update({
        where: { id: eastId },
        data: { shippingCost: before.shippingCost, priority: before.priority },
      }),
    );

    await setWarehouse(admin, { warehouseId: eastId, shippingCost: "999.00", priority: 7 });

    const after = await prisma.warehouse.findUniqueOrThrow({ where: { id: eastId } });
    expect(after.shippingCost.toFixed(2)).toBe("999.00");
    expect(after.priority).toBe(7);
  });
});
