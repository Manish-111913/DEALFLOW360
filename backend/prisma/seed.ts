import { appendAudit, verifyAuditChain } from "../src/audit";
import { createPortalUser, registerInternalUser } from "../src/auth/register";
import { issuePortalLink } from "../src/auth/portal-tokens";
import { currentBusinessTime, refreshClockOffset } from "../src/clock";
import { ensureDefaultSettings } from "../src/settings";
import { prisma } from "../src/db";

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

async function main() {
  await refreshClockOffset();

  const settingsWritten = await ensureDefaultSettings();
  console.log(`settings: ${settingsWritten} defaults written`);

  const adminId = (await seedIdentity()) ?? null;
  const resolvedAdminId =
    adminId ?? (await prisma.user.findUnique({ where: { email: "admin@dealflow360.test" } }))?.id ?? null;

  await seedCustomers(resolvedAdminId);
  await seedCatalog();

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
