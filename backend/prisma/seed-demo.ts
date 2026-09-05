import { currentBusinessTime, refreshClockOffset } from "../src/clock";
import { prisma } from "../src/db";
import { addQuotationLine, createQuotation } from "../src/services/quotations";
import { submitForApproval } from "../src/services/approvals";
import { allocateFulfillment, planFulfillment } from "../src/services/fulfillment";
import { createSubscriptionsForOrder, invoiceOneTimeLines } from "../src/services/billing";
import { shareWithCustomer } from "../src/services/portal";
import { recomputeAllDealHealth } from "../src/services/deal-health";
import type { AuthzUser } from "../src/authz/roles";

/**
 * The live demo story.
 *
 * `seed.ts` builds the historical corpus D23 calls for - ~40 confirmed orders
 * whose job is to give co-purchase rates and per-rep discount averages
 * something real to be derived from. That corpus is deliberately all in the
 * past: every quotation is CONFIRMED.
 *
 * Which means that after a plain seed nothing is in flight, and five of the
 * seven screens have genuinely nothing to render. This script adds the deals
 * that are still moving, one per screen that needs one.
 *
 * Everything goes through the real services rather than raw prisma writes, so
 * the rows obey the rules the application enforces: margins and risk are
 * recomputed by the D21 pipeline, approval routing decides its own steps, and
 * the allocator picks the split.
 *
 * Each deal is guarded separately, and that matters: *using* the demo consumes
 * it. Approving the pending quotation empties the approvals queue; allocating
 * empties the fulfilment screen. Re-running tops up whatever has been used
 * without disturbing what has not.
 */

const SEED_FIRST = "Run `npm run db:seed` first.";

async function internal(email: string): Promise<AuthzUser> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new Error(`Expected seeded user ${email}. ${SEED_FIRST}`);
  return {
    id: user.id,
    kind: user.kind,
    role: user.role,
    customerId: null,
    salesTeamId: user.salesTeamId,
  };
}

async function customerId(name: string): Promise<string> {
  const customer = await prisma.customer.findUnique({ where: { name } });
  if (!customer) throw new Error(`Expected seeded customer ${name}. ${SEED_FIRST}`);
  return customer.id;
}

async function productId(sku: string): Promise<string> {
  const product = await prisma.product.findUnique({ where: { sku } });
  if (!product) throw new Error(`Expected seeded product ${sku}. ${SEED_FIRST}`);
  return product.id;
}

interface Cast {
  priya: AuthzUser;
  finance: AuthzUser;
  acme: string;
  beta: string;
  laptop: string;
  setup: string;
  support: string;
  now: Date;
  validUntil: Date;
}

function skip(label: string) {
  console.log(`${label.padEnd(16)} already present, skipping`);
}

// ---------------------------------------------------------------------------
// One deal per screen that needs a live one
// ---------------------------------------------------------------------------

/** Screen 2 - something for the Sales Workspace to resume. */
async function seedDraft(cast: Cast) {
  const existing = await prisma.quotation.count({
    where: { status: "DRAFT", approvalState: "NONE" },
  });
  if (existing > 0) return skip("draft");

  const draft = await createQuotation({
    customerId: cast.acme,
    salesRepId: cast.priya.id,
    actorId: cast.priya.id,
    validUntil: cast.validUntil,
  });
  await addQuotationLine({
    quotationId: draft.id,
    productId: cast.laptop,
    quantity: 10,
    discountPercentage: 12,
    actorId: cast.priya.id,
  });
  console.log(`draft            ${draft.quoteNumber}  (Acme, 10x laptop @12%)`);
}

/**
 * Screen 3 - something awaiting a decision.
 *
 * The 18% on the setup service is over its 10% category ceiling, which is what
 * routes it to a manager and what the exception table shows.
 */
async function seedPendingApproval(cast: Cast) {
  const existing = await prisma.quotation.count({
    where: { approvalState: { in: ["PENDING_MANAGER", "PENDING_FINANCE"] } },
  });
  if (existing > 0) return skip("pending approval");

  const pending = await createQuotation({
    customerId: cast.acme,
    salesRepId: cast.priya.id,
    actorId: cast.priya.id,
    validUntil: cast.validUntil,
  });
  await addQuotationLine({
    quotationId: pending.id,
    productId: cast.laptop,
    quantity: 10,
    discountPercentage: 12,
    actorId: cast.priya.id,
  });
  await addQuotationLine({
    quotationId: pending.id,
    productId: cast.setup,
    quantity: 1,
    discountPercentage: 18,
    actorId: cast.priya.id,
  });
  const routed = await submitForApproval({ quotationId: pending.id, actorId: cast.priya.id });
  console.log(
    `pending approval ${pending.quoteNumber}  (approval required: ${routed.approvalRequired})`,
  );
}

/** Screen 4 - an approved order that still needs allocating. */
async function seedUnallocated(cast: Cast) {
  const existing = await prisma.quotation.count({
    where: { status: "SENT", approvalState: "APPROVED", fulfillmentPlans: { none: {} } },
  });
  if (existing > 0) return skip("to allocate");

  const order = await createQuotation({
    customerId: cast.beta,
    salesRepId: cast.priya.id,
    actorId: cast.priya.id,
    validUntil: cast.validUntil,
  });
  await addQuotationLine({
    quotationId: order.id,
    productId: cast.laptop,
    quantity: 20,
    discountPercentage: 8,
    actorId: cast.priya.id,
  });
  await prisma.quotation.update({
    where: { id: order.id },
    data: { status: "SENT", approvalState: "APPROVED", approvedAt: cast.now },
  });
  const plan = await planFulfillment(order.id);
  console.log(`to allocate      ${order.quoteNumber}  (plan ${plan.planId ? "created" : "none"})`);
}

/** Screen 5 - a confirmed order billed both ways: one-time lines and a subscription. */
async function seedBilled(cast: Cast) {
  if ((await prisma.subscription.count()) > 0) return skip("confirmed");

  const billed = await createQuotation({
    customerId: cast.acme,
    salesRepId: cast.priya.id,
    actorId: cast.priya.id,
    validUntil: cast.validUntil,
  });
  await addQuotationLine({
    quotationId: billed.id,
    productId: cast.laptop,
    quantity: 10,
    discountPercentage: 12,
    actorId: cast.priya.id,
  });
  await addQuotationLine({
    quotationId: billed.id,
    productId: cast.setup,
    quantity: 1,
    discountPercentage: 18,
    actorId: cast.priya.id,
  });
  // Without a subscription product the order is one-time only, and the Billing
  // screen has no recurring schedule to show.
  await addQuotationLine({
    quotationId: billed.id,
    productId: cast.support,
    quantity: 10,
    actorId: cast.priya.id,
  });
  await prisma.quotation.update({
    where: { id: billed.id },
    data: {
      status: "CONFIRMED",
      approvalState: "APPROVED",
      approvedAt: cast.now,
      confirmedAt: cast.now,
    },
  });
  await allocateFulfillment({ quotationId: billed.id, user: cast.finance });
  const subs = await createSubscriptionsForOrder({
    quotationId: billed.id,
    actorId: cast.finance.id,
  });
  const invoiced = await invoiceOneTimeLines({ quotationId: billed.id, actorId: cast.finance.id });
  console.log(
    `confirmed        ${billed.quoteNumber}  ` +
      `(subscriptions: ${subs.created}, invoiced: ${invoiced ? "yes" : "no"})`,
  );
}

/** Screen 6 - one shared to the customer portal. */
async function seedShared(cast: Cast) {
  const existing = await prisma.quotation.count({
    where: { portalStatus: { not: "NOT_SHARED" } },
  });
  if (existing > 0) return skip("shared to portal");

  const shared = await createQuotation({
    customerId: cast.acme,
    salesRepId: cast.priya.id,
    actorId: cast.priya.id,
    validUntil: cast.validUntil,
  });
  await addQuotationLine({
    quotationId: shared.id,
    productId: cast.laptop,
    quantity: 10,
    discountPercentage: 12,
    actorId: cast.priya.id,
  });
  await addQuotationLine({
    quotationId: shared.id,
    productId: cast.setup,
    quantity: 1,
    discountPercentage: 18,
    actorId: cast.priya.id,
  });
  await prisma.quotation.update({
    where: { id: shared.id },
    data: { status: "SENT", approvalState: "APPROVED", approvedAt: cast.now },
  });
  await shareWithCustomer({ quotationId: shared.id, actorId: cast.priya.id });
  console.log(`shared to portal ${shared.quoteNumber}`);
}

/**
 * Health scores are computed on a schedule, never on write - so without this
 * the Deal Health board is empty however many live deals exist. It runs every
 * time, because it is a pass over whatever exists rather than a creation.
 */
async function scoreHealth() {
  const scored = await recomputeAllDealHealth();
  console.log(`health scored    ${scored.scored} live deal(s)`);
}

async function report() {
  const rows = await prisma.quotation.groupBy({ by: ["status"], _count: { _all: true } });
  console.log("\nquotations by status:");
  for (const row of rows) console.log(`  ${row.status.padEnd(18)} ${row._count._all}`);
  console.log(`  subscriptions      ${await prisma.subscription.count()}`);
  console.log(`  invoices           ${await prisma.invoice.count()}`);
  console.log(`  health snapshots   ${await prisma.dealHealthSnapshot.count()}`);
  console.log(`  open alerts        ${await prisma.dealAlert.count()}`);
}

async function main() {
  await refreshClockOffset();
  const now = currentBusinessTime();

  const cast: Cast = {
    priya: await internal("priya@dealflow360.test"),
    finance: await internal("finance@dealflow360.test"),
    acme: await customerId("Acme Industries"),
    beta: await customerId("Beta Industries"),
    laptop: await productId("HW-LAPTOP-PRO"),
    setup: await productId("SV-SETUP"),
    support: await productId("SUB-SUPPORT"),
    now,
    validUntil: new Date(now.getTime() + 15 * 24 * 60 * 60 * 1000),
  };

  await seedDraft(cast);
  await seedPendingApproval(cast);
  await seedUnallocated(cast);
  await seedBilled(cast);
  await seedShared(cast);

  await scoreHealth();
  await report();
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
