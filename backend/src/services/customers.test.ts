import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthzUser } from "../authz/roles";
import { assertCustomerCanBeQuoted, readCustomer, setCustomerTier } from "./customers";
import { auditTrailFor } from "../audit";
import { currentBusinessTime } from "../clock";
import { ValidationError } from "../errors";
import { prisma } from "../db";

let acmeId: string;
let betaId: string;
let acmePortal: AuthzUser;
let betaPortal: AuthzUser;
let rep: AuthzUser;

beforeAll(async () => {
  const acme = await prisma.customer.findUniqueOrThrow({ where: { name: "Acme Industries" } });
  const beta = await prisma.customer.findUniqueOrThrow({ where: { name: "Beta Industries" } });
  acmeId = acme.id;
  betaId = beta.id;

  const acmeUser = await prisma.user.findUniqueOrThrow({ where: { email: "buyer@acme.test" } });
  const betaUser = await prisma.user.findUniqueOrThrow({ where: { email: "buyer@beta.test" } });
  const repUser = await prisma.user.findUniqueOrThrow({ where: { email: "priya@dealflow360.test" } });

  acmePortal = { id: acmeUser.id, kind: "PORTAL", role: null, customerId: acmeUser.customerId, salesTeamId: null };
  betaPortal = { id: betaUser.id, kind: "PORTAL", role: null, customerId: betaUser.customerId, salesTeamId: null };
  rep = { id: repUser.id, kind: "INTERNAL", role: "SALES_REP", customerId: null, salesTeamId: repUser.salesTeamId };
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("cross-customer isolation", () => {
  it("lets a portal user read their own customer", async () => {
    const result = await readCustomer(acmePortal, acmeId);
    expect(result.status).toBe(200);
  });

  // The named acceptance check. Beta must be refused Acme's record with a 403,
  // not an empty result that reads as "nothing here".
  it("refuses the Beta portal user access to Acme with 403", async () => {
    const result = await readCustomer(betaPortal, acmeId);
    expect(result.status).toBe(403);
  });

  it("refuses in the other direction too", async () => {
    expect((await readCustomer(acmePortal, betaId)).status).toBe(403);
  });

  it("returns 404 for a record that genuinely does not exist", async () => {
    expect((await readCustomer(acmePortal, "does-not-exist")).status).toBe(404);
  });

  it("returns 401 when unauthenticated", async () => {
    expect((await readCustomer(null, acmeId)).status).toBe(401);
  });

  it("lets an internal rep read any customer", async () => {
    expect((await readCustomer(rep, acmeId)).status).toBe(200);
    expect((await readCustomer(rep, betaId)).status).toBe(200);
  });
});

/**
 * The tier requirement, enforced twice on purpose.
 *
 * Without a tier there is no discount ceiling to check a line against, so every
 * governance rule downstream would pass vacuously — the quote would look
 * compliant precisely because nothing was checked.
 */
describe("a quotation cannot exist for a customer with no tier", () => {
  it("raises a ValidationError naming the tier field", async () => {
    const now = currentBusinessTime();
    const tierless = await prisma.customer.create({
      data: { name: `Tierless Co ${now.getTime()}`, createdAt: now, updatedAt: now },
    });

    try {
      await assertCustomerCanBeQuoted(tierless.id);
      throw new Error("expected assertCustomerCanBeQuoted to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      const validation = error as ValidationError;
      expect(validation.field).toBe("tier");
      expect(validation.message).toMatch(/tier/i);
      expect(validation.status).toBe(422);
    } finally {
      await prisma.customer.delete({ where: { id: tierless.id } });
    }
  });

  it("passes for a customer that has one", async () => {
    await expect(assertCustomerCanBeQuoted(acmeId)).resolves.toBeUndefined();
  });

  // The service message is what makes the failure usable; this is the backstop
  // that holds when someone writes to the table by another route.
  it("is refused by the database trigger too, not only by the service", async () => {
    const now = currentBusinessTime();
    const tierless = await prisma.customer.create({
      data: { name: `Trigger Probe ${now.getTime()}`, createdAt: now, updatedAt: now },
    });
    const salesRep = await prisma.user.findUniqueOrThrow({
      where: { email: "priya@dealflow360.test" },
    });

    try {
      await expect(
        prisma.$executeRaw`
          INSERT INTO "Quotation"
            ("id","quoteNumber","customerId","salesRepId","lastActivityAt","createdAt","updatedAt")
          VALUES
            ('probe-no-tier','Q-PROBE-NO-TIER',${tierless.id},${salesRep.id},${now},${now},${now})
        `,
      ).rejects.toThrow(/no tier set/i);
    } finally {
      await prisma.customer.delete({ where: { id: tierless.id } });
    }
  });
});

describe("tier changes are audited", () => {
  it("records the before and after values", async () => {
    const now = currentBusinessTime();
    const customer = await prisma.customer.create({
      data: { name: `Tier Audit Co ${now.getTime()}`, tier: "BRONZE", createdAt: now, updatedAt: now },
    });

    // A tier change silently alters which ceiling every open quotation for this
    // customer is checked against, which is why it is audited rather than
    // treated as an ordinary contact-record edit.
    await setCustomerTier({ customerId: customer.id, tier: "GOLD", reason: "Promoted to Gold" });

    const trail = await auditTrailFor("Customer", customer.id);
    const change = trail.at(-1);

    expect(change?.action).toBe("UPDATE");
    expect(change?.reason).toBe("Promoted to Gold");
    expect(change?.fieldChanges).toEqual({ tier: { before: "BRONZE", after: "GOLD" } });

    const reread = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } });
    expect(reread.tier).toBe("GOLD");

    // Left in place: the customer now has audit history, and an audited actor
    // or record is deactivated rather than deleted (D19).
    await prisma.customer.update({ where: { id: customer.id }, data: { status: "INACTIVE" } });
  });
});
