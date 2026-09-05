import { appendAudit, verifyAuditChain } from "../src/audit";
import { createPortalUser, registerInternalUser } from "../src/auth/register";
import { issuePortalLink } from "../src/auth/portal-tokens";
import { currentBusinessTime, refreshClockOffset } from "../src/clock";
import { ensureDefaultSettings } from "../src/settings";
import { prisma } from "../src/db";
import { computeOrderMargin } from "../src/engines/margin";
import { refreshCoPurchaseRates } from "../src/services/upsell";

/**
 * Seed data.
 *
 * Each section is guarded by its own count check, so re-running adds what is
 * missing without needing a full reset. AuditLog cannot be deleted (D19), so a
 * blanket wipe-and-reseed is not available; `npm run db:reset` is the way to
 * start clean.
 *
 * The historical order volume that D23 calls for (~40 confirmed orders driving
 * derived co-purchase rates and per-rep discount averages) lands with B-3, once
 * quotations exist to create.
 */

const DEV_PASSWORD = "DealFlow!2026";

// ---------------------------------------------------------------------------
// Catalogue figures
//
// These numbers are not arbitrary. They are chosen so the worked examples
// frozen in 03_BUSINESS_RULES.md reproduce exactly against seeded data rather
// than only on paper. Changing one silently breaks a demo figure.
//
//   Laptop Pro, Gold price 5,000, cost 3,200
//     10 units at 12% discount -> subtotal 50,000, discount 6,000,
//     net 44,000, cost 32,000, margin 12,000 = 27.3%          [margin example]
//
//   + Setup Service at 18% (20,000 x 0.82 = 16,400 net, cost 15,100)
//     order net 60,400, cost 47,100, margin 13,300 = 22.0%    [demo, step 1]
//
//   + Onboarding Training at 13% (15,000 x 0.87 = 13,050 net, cost 10,179)
//     that line is itself 22.0%, so the order stays at 22.0%  [risk example]
//
//   Extended Warranty 12,923 - 4,523 = 8,400 margin = 65.0%   [upsell example]
// ---------------------------------------------------------------------------

async function seedIdentity() {
  if ((await prisma.user.count()) > 0) {
    console.log("identity: already seeded, skipping");
    return;
  }

  const now = currentBusinessTime();

  await prisma.clockOffset.upsert({
    where: { id: 1 },
    create: { id: 1, offsetMs: 0n, updatedAt: now, updatedByEmail: "seed" },
    update: {},
  });

  // SalesTeam and User reference each other, so the team is created first
  // without a manager and linked once the manager exists.
  const team = await prisma.salesTeam.create({
    data: { name: "North Enterprise", createdAt: now, updatedAt: now },
  });

  const admin = await registerInternalUser({
    email: "admin@dealflow360.test",
    name: "Ada Admin",
    password: DEV_PASSWORD,
    role: "ADMIN",
  });

  const manager = await registerInternalUser({
    email: "manager@dealflow360.test",
    name: "Meera Manager",
    password: DEV_PASSWORD,
    role: "SALES_MANAGER",
    salesTeamId: team.id,
  });

  // Priya is the rep named throughout 34_DEMO_FLOW.md.
  await registerInternalUser({
    email: "priya@dealflow360.test",
    name: "Priya Sharma",
    password: DEV_PASSWORD,
    role: "SALES_REP",
    salesTeamId: team.id,
  });

  // A second rep on the same team, so "manager sees their team, rep sees only
  // their own" is actually testable rather than vacuously true.
  await registerInternalUser({
    email: "rahul@dealflow360.test",
    name: "Rahul Verma",
    password: DEV_PASSWORD,
    role: "SALES_REP",
    salesTeamId: team.id,
  });

  await registerInternalUser({
    email: "finance@dealflow360.test",
    name: "Farid Finance",
    password: DEV_PASSWORD,
    role: "FINANCE_OPS",
  });

  await prisma.salesTeam.update({
    where: { id: team.id },
    data: { managerId: manager.id, updatedAt: now },
  });

  console.log("identity: 5 internal users + sales team created");
  return admin.id;
}

async function seedCustomers(adminId: string | null) {
  const now = currentBusinessTime();
  const priya = await prisma.user.findUnique({ where: { email: "priya@dealflow360.test" } });

  // One customer per tier. Acme is the demo account; Beta exists so the
  // cross-customer 403 test has a genuine second tenant to attempt access from;
  // Cobalt is Bronze and carries no price list, which exercises the base-price
  // fallback in resolveUnitPrice.
  const tiers = [
    { name: "Acme Industries", tier: "GOLD" as const, contact: "Anita Rao" },
    { name: "Beta Industries", tier: "SILVER" as const, contact: "Ben Ortiz" },
    { name: "Cobalt Systems", tier: "BRONZE" as const, contact: "Chen Wu" },
  ];

  let created = 0;
  for (const t of tiers) {
    // Checked per customer rather than "any customer exists", so a later tier
    // added to this list still gets seeded on an existing database.
    if (await prisma.customer.findUnique({ where: { name: t.name } })) continue;

    created += 1;
    const customer = await prisma.customer.create({
      data: {
        name: t.name,
        tier: t.tier,
        contactName: t.contact,
        assignedSalesRepId: priya?.id ?? null,
        createdAt: now,
        updatedAt: now,
      },
    });
    await appendAudit({
      entityName: "Customer",
      entityId: customer.id,
      action: "CREATE",
      actorId: adminId,
      reason: "Seed data",
      fieldChanges: { name: customer.name, tier: customer.tier },
    });
  }

  const acme = await prisma.customer.findUniqueOrThrow({ where: { name: "Acme Industries" } });
  const beta = await prisma.customer.findUniqueOrThrow({ where: { name: "Beta Industries" } });

  for (const p of [
    { email: "buyer@acme.test", name: "Anita Rao (Acme)", customerId: acme.id },
    { email: "buyer@beta.test", name: "Ben Ortiz (Beta)", customerId: beta.id },
  ]) {
    if (await prisma.user.findUnique({ where: { email: p.email } })) continue;
    await createPortalUser({ ...p, actorId: adminId ?? undefined });
  }

  console.log(`customers: ${created} created (one per tier), portal users ensured`);
}

async function seedCatalog() {
  if ((await prisma.product.count()) > 0) {
    console.log("catalog: already seeded, skipping");
    return;
  }

  const now = currentBusinessTime();

  const gst = await prisma.tax.create({
    data: { name: "GST 18%", percentage: "18.00" },
  });

  // §B3 asks the builder to pick products "across categories (Hardware,
  // Services, Subscriptions)".
  const [hardware, services, subscriptions] = await Promise.all([
    prisma.productCategory.create({ data: { name: "Hardware" } }),
    prisma.productCategory.create({ data: { name: "Services" } }),
    prisma.productCategory.create({ data: { name: "Subscriptions" } }),
  ]);

  const products = [
    {
      sku: "HW-LAPTOP-PRO",
      name: "Laptop Pro",
      categoryId: hardware.id,
      type: "PRODUCT" as const,
      basePrice: "5400.00",
      costPrice: "3200.00",
      unit: "unit",
      taxId: gst.id,
    },
    {
      sku: "SV-SETUP",
      name: "Setup Service",
      categoryId: services.id,
      type: "SERVICE" as const,
      basePrice: "20000.00",
      costPrice: "15100.00",
      unit: "engagement",
      taxId: gst.id,
    },
    {
      sku: "SV-ONBOARD",
      name: "Onboarding Training",
      categoryId: services.id,
      type: "SERVICE" as const,
      basePrice: "15000.00",
      costPrice: "10179.00",
      unit: "engagement",
      taxId: gst.id,
    },
    {
      sku: "HW-WARRANTY-EXT",
      name: "Extended Warranty",
      categoryId: hardware.id,
      type: "SERVICE" as const,
      basePrice: "12923.00",
      costPrice: "4523.00",
      unit: "year",
      taxId: gst.id,
      // A6 — promoted products rank higher in upsell suggestions.
      isPromoted: true,
    },
    {
      sku: "SUB-SUPPORT",
      name: "Support Subscription",
      categoryId: subscriptions.id,
      type: "SUBSCRIPTION" as const,
      basePrice: "12000.00",
      costPrice: "4000.00",
      unit: "month",
      taxId: gst.id,
    },
  ];

  for (const p of products) {
    await prisma.product.create({ data: { ...p, createdAt: now, updatedAt: now } });
  }

  // §A2 requires variants with an attribute, values and extra prices.
  const laptop = await prisma.product.findUniqueOrThrow({ where: { sku: "HW-LAPTOP-PRO" } });
  await prisma.productVariant.createMany({
    data: [
      {
        productId: laptop.id,
        sku: "HW-LAPTOP-PRO-16",
        attributeName: "RAM",
        attributeValue: "16 GB",
        extraPrice: "0.00",
      },
      {
        productId: laptop.id,
        sku: "HW-LAPTOP-PRO-32",
        attributeName: "RAM",
        attributeValue: "32 GB",
        extraPrice: "800.00",
      },
    ],
  });

  // §A2 tier-based pricing. Gold is priced at 5,000 deliberately: that is the
  // figure the frozen margin example uses. Bronze has no price list at all, so
  // it falls back to the 5,400 base price — the fallback path matters as much
  // as the hit, since most products carry no tier price.
  const goldList = await prisma.priceList.create({
    data: { name: "Gold Tier Pricing", tier: "GOLD", createdAt: now, updatedAt: now },
  });
  const silverList = await prisma.priceList.create({
    data: { name: "Silver Tier Pricing", tier: "SILVER", createdAt: now, updatedAt: now },
  });

  await prisma.priceListItem.createMany({
    data: [
      { priceListId: goldList.id, productId: laptop.id, price: "5000.00", minQuantity: 1 },
      { priceListId: silverList.id, productId: laptop.id, price: "5200.00", minQuantity: 1 },
    ],
  });

  console.log("catalog: 3 categories, 1 tax, 5 products, 2 variants, 2 price lists created");
}


/**
 * Discount governance and the approval chain.
 *
 * D10 has two levels: a tier default, and a category-specific override. The
 * seeded values are the ones §A3 and page 12 of the problem statement use, so
 * the documented worked example reproduces against real configuration:
 *
 *   Gold is 15% generally, but Services only 10% because margins are thin.
 *   Subscriptions has no policy at all, so it falls back to the tier default -
 *   which is the D10 step that would otherwise go untested.
 *
 * D11 keeps the 30/60 thresholds in the ApprovalChain table rather than an
 * `if`, seeded to reproduce the documented behaviour exactly.
 */
async function seedGovernance(adminId: string | null) {
  const now = currentBusinessTime();

  const tierDefaults = [
    { tier: "BRONZE" as const, max: "5.00" },
    { tier: "SILVER" as const, max: "10.00" },
    { tier: "GOLD" as const, max: "15.00" },
  ];
  for (const t of tierDefaults) {
    if (await prisma.discountTier.findFirst({ where: { tier: t.tier } })) continue;
    await prisma.discountTier.create({
      data: {
        tier: t.tier,
        defaultMaxDiscount: t.max,
        createdAt: now,
        updatedAt: now,
      },
    });
  }

  const hardware = await prisma.productCategory.findUnique({ where: { name: "Hardware" } });
  const services = await prisma.productCategory.findUnique({ where: { name: "Services" } });

  if (hardware && services) {
    const policies = [
      { tier: "GOLD" as const, categoryId: hardware.id, max: "15.00" },
      { tier: "GOLD" as const, categoryId: services.id, max: "10.00" },
      { tier: "SILVER" as const, categoryId: services.id, max: "8.00" },
      { tier: "BRONZE" as const, categoryId: services.id, max: "5.00" },
    ];
    for (const p of policies) {
      const existing = await prisma.discountPolicy.findFirst({
        where: { tier: p.tier, categoryId: p.categoryId, isActive: true },
      });
      if (existing) continue;
      await prisma.discountPolicy.create({
        data: {
          tier: p.tier,
          categoryId: p.categoryId,
          maxDiscount: p.max,
          createdAt: now,
          updatedAt: now,
        },
      });
    }
  }

  let chain = await prisma.approvalChain.findFirst({ where: { isActive: true } });
  if (!chain) {
    chain = await prisma.approvalChain.create({
      data: { name: "Default Approval Chain", createdAt: now, updatedAt: now },
    });
    await prisma.approvalStep.createMany({
      data: [
        {
          approvalChainId: chain.id,
          stepOrder: 1,
          approverRole: "SALES_MANAGER",
          minRiskScore: "30.00",
        },
        {
          approvalChainId: chain.id,
          stepOrder: 2,
          approverRole: "FINANCE_OPS",
          minRiskScore: "60.00",
        },
      ],
    });
  }

  await appendAudit({
    entityName: "ApprovalChain",
    entityId: chain.id,
    action: "CONFIGURE",
    actorId: adminId,
    reason: "Seed data",
    fieldChanges: { name: chain.name, thresholds: "manager from 30, finance from 60" },
  });

  const tiers = await prisma.discountTier.count();
  const policies = await prisma.discountPolicy.count();
  console.log(`governance: ${tiers} tier defaults, ${policies} category policies, 1 approval chain`);
}


/**
 * D23 - historical orders, so the analytics have something real to read.
 *
 * These are not decoration. Three features are dead without them:
 *
 *   D14  co-purchase rates are derived from confirmed orders. The documented
 *        0.72 for Laptop Pro -> Extended Warranty is produced here as a fact:
 *        25 orders contain the laptop and 18 of those also contain the
 *        warranty. 18/25 = 0.72 exactly. Nobody types that number.
 *
 *   B-9  the discount-anomaly signal compares a quote against the rolling
 *        average of the rep who wrote it, so the two reps are given
 *        deliberately different discounting habits.
 *
 *   B-10 every report is empty without history.
 *
 * Written directly rather than through the service layer: this is data that
 * predates the system, so it carries no audit trail and skipping the per-order
 * recompute keeps seeding to a couple of seconds.
 */
async function seedHistory() {
  const existing = await prisma.quotation.count({ where: { quoteNumber: { startsWith: "H-" } } });
  if (existing > 0) {
    console.log("history: already seeded, skipping");
    return;
  }

  const [priya, rahul] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { email: "priya@dealflow360.test" } }),
    prisma.user.findUniqueOrThrow({ where: { email: "rahul@dealflow360.test" } }),
  ]);
  const customers = await prisma.customer.findMany({ orderBy: { name: "asc" } });
  const products = await prisma.product.findMany({ include: { tax: true } });
  const bySku = new Map(products.map((p) => [p.sku, p]));

  const laptop = bySku.get("HW-LAPTOP-PRO")!;
  const warranty = bySku.get("HW-WARRANTY-EXT")!;
  const setup = bySku.get("SV-SETUP")!;
  const onboard = bySku.get("SV-ONBOARD")!;
  const support = bySku.get("SUB-SUPPORT")!;

  const now = currentBusinessTime();
  const dayMs = 86_400_000;

  interface HistoryOrder {
    products: typeof laptop[];
    repId: string;
    discount: string;
    daysAgo: number;
    customerId: string;
  }

  const orders: HistoryOrder[] = [];

  // 25 laptop orders; the first 18 also carry the warranty -> 18/25 = 0.72.
  for (let i = 0; i < 25; i += 1) {
    const withWarranty = i < 18;
    // Priya discounts harder than Rahul, which is what gives B-9 a baseline to
    // detect an outlier against.
    const rep = i % 2 === 0 ? priya : rahul;
    const discount = rep.id === priya.id ? "10.00" : "5.00";
    orders.push({
      products: withWarranty ? [laptop, warranty] : [laptop],
      repId: rep.id,
      discount,
      daysAgo: 120 - i * 4,
      customerId: customers[i % customers.length].id,
    });
  }

  // 15 service and subscription orders, so other pairings have real rates too.
  const serviceMixes = [
    [setup, onboard],
    [setup, support],
    [onboard, support],
    [setup],
    [support],
  ];
  for (let i = 0; i < 15; i += 1) {
    const rep = i % 2 === 0 ? rahul : priya;
    orders.push({
      products: serviceMixes[i % serviceMixes.length],
      repId: rep.id,
      discount: rep.id === priya.id ? "9.00" : "4.00",
      daysAgo: 110 - i * 6,
      customerId: customers[(i + 1) % customers.length].id,
    });
  }

  let sequence = 0;
  for (const order of orders) {
    sequence += 1;
    const placedAt = new Date(now.getTime() - order.daysAgo * dayMs);

    const lines = order.products.map((product, index) => {
      const quantity = product.sku === "HW-LAPTOP-PRO" ? 5 + (sequence % 6) : 1;
      return {
        product,
        index,
        quantity,
        unitPrice: product.basePrice,
        discountPercentage: order.discount,
        unitCost: product.costPrice,
      };
    });

    const margin = computeOrderMargin(
      lines.map((l) => ({
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        discountPercentage: l.discountPercentage,
        unitCost: l.unitCost,
      })),
    );

    await prisma.quotation.create({
      data: {
        quoteNumber: `H-${String(sequence).padStart(4, "0")}`,
        customerId: order.customerId,
        salesRepId: order.repId,
        status: "CONFIRMED",
        approvalState: "APPROVED",
        portalStatus: "CONFIRMED",
        subtotal: margin.subtotal,
        discountAmount: margin.discountAmount,
        totalAmount: margin.netSellingValue,
        totalCost: margin.estimatedCost,
        grossMargin: margin.grossMargin,
        marginPercentage: margin.marginPercentage,
        lastActivityAt: placedAt,
        createdAt: placedAt,
        updatedAt: placedAt,
        submittedAt: placedAt,
        approvedAt: placedAt,
        confirmedAt: placedAt,
        lines: {
          create: lines.map((l) => {
            const computed = margin.lines[l.index];
            return {
              productId: l.product.id,
              sequence: l.index,
              quantity: l.quantity,
              unitPrice: l.unitPrice,
              discountPercentage: l.discountPercentage,
              discountAmount: computed.discountAmount,
              lineSubtotal: computed.subtotal,
              lineTotal: computed.netSellingValue,
              unitCost: l.unitCost,
              marginAmount: computed.grossMargin,
              marginPercentage: computed.marginPercentage,
              isRecurring: l.product.type === "SUBSCRIPTION",
              createdAt: placedAt,
              updatedAt: placedAt,
            };
          }),
        },
      },
    });
  }

  const refreshed = await refreshCoPurchaseRates();
  console.log(
    `history: ${orders.length} confirmed orders, ${refreshed.pairsWritten} co-purchase pairings derived`,
  );
}


/**
 * Warehouses and stock.
 *
 * The two named in the worked example, with the stock levels it uses: Main
 * holds 12 laptops and East Depot 8, so a 20-unit order splits 12/8 across two
 * shipments and a 25-unit order leaves a 5-unit backorder.
 *
 * Priority and per-shipment cost are columns, not constants: §A4 asks for
 * "shipping cost weighting used by the auto split logic", so an admin can
 * change how the allocator behaves without a deploy.
 */
async function seedWarehouses() {
  if ((await prisma.warehouse.count()) > 0) {
    console.log("warehouses: already seeded, skipping");
    return;
  }

  const now = currentBusinessTime();

  const main = await prisma.warehouse.create({
    data: {
      name: "Main Warehouse",
      code: "MAIN",
      priority: 1,
      shippingCost: "150.00",
      createdAt: now,
      updatedAt: now,
    },
  });
  const east = await prisma.warehouse.create({
    data: {
      name: "East Depot",
      code: "EAST",
      priority: 2,
      shippingCost: "220.00",
      createdAt: now,
      updatedAt: now,
    },
  });

  const laptop = await prisma.product.findUniqueOrThrow({ where: { sku: "HW-LAPTOP-PRO" } });
  const warranty = await prisma.product.findUniqueOrThrow({ where: { sku: "HW-WARRANTY-EXT" } });
  const setup = await prisma.product.findUniqueOrThrow({ where: { sku: "SV-SETUP" } });
  const onboard = await prisma.product.findUniqueOrThrow({ where: { sku: "SV-ONBOARD" } });

  const stock = [
    // The worked example: 12 at Main, 8 at East.
    { warehouseId: main.id, productId: laptop.id, availableQuantity: 12, reorderLevel: 5, reorderQuantity: 20 },
    { warehouseId: east.id, productId: laptop.id, availableQuantity: 8, reorderLevel: 4, reorderQuantity: 15 },
    // Services are performed rather than shipped, but they still need a stock
    // row so the allocator can source them somewhere.
    { warehouseId: main.id, productId: warranty.id, availableQuantity: 100 },
    { warehouseId: main.id, productId: setup.id, availableQuantity: 100 },
    { warehouseId: main.id, productId: onboard.id, availableQuantity: 100 },
  ];

  for (const row of stock) {
    await prisma.warehouseStock.create({ data: { ...row, updatedAt: now } });
  }

  console.log("warehouses: Main (12 laptops) and East Depot (8 laptops) created");
}


/**
 * Subscription plans.
 *
 * The one the worked example uses: Support Subscription at 12,000 a month.
 * Starting it part-way through a 30-day month produces the documented
 * first-cycle charge of 6,400.
 *
 * Proration, cancellation and refund behaviour are columns rather than
 * constants, because §A5 asks for them to be configurable per plan.
 */
async function seedSubscriptionPlans() {
  if ((await prisma.subscriptionPlan.count()) > 0) {
    console.log("plans: already seeded, skipping");
    return;
  }

  const now = currentBusinessTime();
  const support = await prisma.product.findUniqueOrThrow({ where: { sku: "SUB-SUPPORT" } });

  await prisma.subscriptionPlan.create({
    data: {
      name: "Support Subscription - Monthly",
      productId: support.id,
      billingInterval: "MONTHLY",
      price: support.basePrice,
      createdAt: now,
      updatedAt: now,
    },
  });

  console.log("plans: Support Subscription monthly at 12,000 created");
}

async function main() {
  await refreshClockOffset();

  const settingsWritten = await ensureDefaultSettings();
  console.log(`settings: ${settingsWritten} defaults written`);

  const adminId = (await seedIdentity()) ?? null;
  const resolvedAdminId =
    adminId ?? (await prisma.user.findUnique({ where: { email: "admin@dealflow360.test" } }))?.id ?? null;

  await seedCustomers(resolvedAdminId);
  await seedCatalog();
  await seedGovernance(resolvedAdminId);
  await seedWarehouses();
  await seedSubscriptionPlans();
  await seedHistory();

  const acme = await prisma.customer.findUnique({ where: { name: "Acme Industries" } });
  const chain = await verifyAuditChain();

  console.log("\nDealFlow360 seed complete\n");
  console.table([
    { role: "ADMIN", email: "admin@dealflow360.test", password: DEV_PASSWORD },
    { role: "SALES_MANAGER", email: "manager@dealflow360.test", password: DEV_PASSWORD },
    { role: "SALES_REP", email: "priya@dealflow360.test", password: DEV_PASSWORD },
    { role: "SALES_REP", email: "rahul@dealflow360.test", password: DEV_PASSWORD },
    { role: "FINANCE_OPS", email: "finance@dealflow360.test", password: DEV_PASSWORD },
  ]);

  const catalog = await prisma.product.findMany({
    include: { category: true },
    orderBy: { sku: "asc" },
  });
  console.table(
    catalog.map((p) => ({
      sku: p.sku,
      name: p.name,
      category: p.category.name,
      base: p.basePrice.toFixed(2),
      cost: p.costPrice.toFixed(2),
    })),
  );

  if (acme) {
    const link = await issuePortalLink(acme.id);
    console.log(
      `Acme portal magic link (single use, expires ${link.expiresAt.toISOString()}):\n` +
        `  /portal/login?token=${link.rawToken}\n`,
    );
  }

  console.log(`Audit chain: ${chain.ok ? "verified" : "BROKEN"} across ${chain.checked} entries.\n`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
