import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError, type AuthzUser } from "../authz/roles";
import { currentBusinessTime } from "../clock";
import { prisma } from "../db";
import { addQuotationLine, createQuotation } from "./quotations";
import { exportSalesReport, runSalesReport } from "./reporting";

const DAY_MS = 86_400_000;

let acmeId: string;
let priyaId: string;
let southRepId: string;
let southTeamId: string;
let laptopId: string;
let setupId: string;
let hardwareCategoryId: string;
let manager: AuthzUser;
let admin: AuthzUser;
let rep: AuthzUser;

let approvedId: string;
let pendingFinanceId: string;
let southQuotationId: string;
const created: string[] = [];

async function quotationFor(
  salesRepId: string,
  productId: string,
  approvalState: "APPROVED" | "PENDING_FINANCE" | "NONE",
) {
  const q = await createQuotation({ customerId: acmeId, salesRepId });
  created.push(q.id);
  await addQuotationLine({ quotationId: q.id, productId, quantity: 2, discountPercentage: "5" });
  await prisma.quotation.update({ where: { id: q.id }, data: { approvalState } });
  return q.id;
}

beforeAll(async () => {
  acmeId = (await prisma.customer.findUniqueOrThrow({ where: { name: "Acme Industries" } })).id;
  const priya = await prisma.user.findUniqueOrThrow({ where: { email: "priya@dealflow360.test" } });
  const m = await prisma.user.findUniqueOrThrow({ where: { email: "manager@dealflow360.test" } });
  const a = await prisma.user.findUniqueOrThrow({ where: { email: "admin@dealflow360.test" } });
  priyaId = priya.id;
  manager = { id: m.id, kind: "INTERNAL", role: "SALES_MANAGER", customerId: null, salesTeamId: m.salesTeamId };
  admin = { id: a.id, kind: "INTERNAL", role: "ADMIN", customerId: null, salesTeamId: null };
  rep = { id: priya.id, kind: "INTERNAL", role: "SALES_REP", customerId: null, salesTeamId: priya.salesTeamId };

  laptopId = (await prisma.product.findUniqueOrThrow({ where: { sku: "HW-LAPTOP-PRO" } })).id;
  setupId = (await prisma.product.findUniqueOrThrow({ where: { sku: "SV-SETUP" } })).id;
  hardwareCategoryId = (
    await prisma.productCategory.findUniqueOrThrow({ where: { name: "Hardware" } })
  ).id;

  // A second team, so "a manager sees only their own team" is testable rather
  // than vacuously true - every seeded rep belongs to North Enterprise.
  const now = currentBusinessTime();
  const southTeam = await prisma.salesTeam.create({
    data: { name: `South Enterprise ${now.getTime()}`, createdAt: now, updatedAt: now },
  });
  southTeamId = southTeam.id;
  const southRep = await prisma.user.create({
    data: {
      email: `south-rep-${now.getTime()}@dealflow360.test`,
      name: "Sofia South",
      kind: "INTERNAL",
      role: "SALES_REP",
      salesTeamId: southTeam.id,
      createdAt: now,
      updatedAt: now,
    },
  });
  southRepId = southRep.id;

  approvedId = await quotationFor(priyaId, laptopId, "APPROVED");
  pendingFinanceId = await quotationFor(priyaId, setupId, "PENDING_FINANCE");
  southQuotationId = await quotationFor(southRepId, laptopId, "PENDING_FINANCE");
});

afterAll(async () => {
  await prisma.quotation.deleteMany({ where: { id: { in: created } } });
  // The south rep authored audited line edits, and an audited actor is
  // deactivated rather than deleted (D19). Detach and disable instead.
  await prisma.user.updateMany({
    where: { id: southRepId },
    data: { active: false, salesTeamId: null },
  });
  await prisma.salesTeam.deleteMany({ where: { id: southTeamId } });
  await prisma.$disconnect();
});

/** The named scenario: two quotations, filter to one approval state. */
describe("filtering by approval status", () => {
  it("returns exactly the matching quotation", async () => {
    const report = await runSalesReport({
      user: admin,
      filters: { approvalStates: ["PENDING_FINANCE"], salesRepId: priyaId },
    });

    expect(report.rows).toHaveLength(1);
    expect(report.rows[0].quotationId).toBe(pendingFinanceId);
    expect(report.rows[0].approvalState).toBe("PENDING_FINANCE");
  });

  it("excludes the one in a different state", async () => {
    const report = await runSalesReport({
      user: admin,
      filters: { approvalStates: ["PENDING_FINANCE"], salesRepId: priyaId },
    });

    expect(report.rows.map((r) => r.quotationId)).not.toContain(approvedId);
  });

  it("accepts several states at once", async () => {
    const report = await runSalesReport({
      user: admin,
      filters: { approvalStates: ["PENDING_FINANCE", "APPROVED"], salesRepId: priyaId },
    });

    const ids = report.rows.map((r) => r.quotationId);
    expect(ids).toContain(pendingFinanceId);
    expect(ids).toContain(approvedId);
  });
});

/** §A7 - the four filters narrow together, they are not exclusive tabs. */
describe("filters compose with AND", () => {
  it("narrows by period as well as status", async () => {
    const now = currentBusinessTime();

    const inWindow = await runSalesReport({
      user: admin,
      filters: {
        salesRepId: priyaId,
        approvalStates: ["PENDING_FINANCE"],
        from: new Date(now.getTime() - DAY_MS),
        to: new Date(now.getTime() + DAY_MS),
      },
    });
    expect(inWindow.rows).toHaveLength(1);

    const outOfWindow = await runSalesReport({
      user: admin,
      filters: {
        salesRepId: priyaId,
        approvalStates: ["PENDING_FINANCE"],
        from: new Date(now.getTime() - 400 * DAY_MS),
        to: new Date(now.getTime() - 300 * DAY_MS),
      },
    });
    expect(outOfWindow.rows).toHaveLength(0);
  });

  it("narrows by product category as well", async () => {
    // The pending-finance quote is a Services line, so a Hardware filter must
    // exclude it even though the status matches.
    const hardware = await runSalesReport({
      user: admin,
      filters: {
        salesRepId: priyaId,
        approvalStates: ["PENDING_FINANCE"],
        categoryId: hardwareCategoryId,
      },
    });
    expect(hardware.rows).toHaveLength(0);

    const services = await runSalesReport({
      user: admin,
      filters: { salesRepId: priyaId, approvalStates: ["PENDING_FINANCE"] },
    });
    expect(services.rows).toHaveLength(1);
  });

  it("narrows by product", async () => {
    // Seeded history also contains Setup Service lines for this rep, so the
    // window pins the result to quotations this file created. The report is
    // global by design; the test must not assume it owns every row.
    const report = await runSalesReport({
      user: admin,
      filters: { salesRepId: priyaId, productId: setupId, from: recently() },
    });

    const ids = report.rows.map((r) => r.quotationId);
    expect(ids).toContain(pendingFinanceId);
    expect(ids).not.toContain(approvedId); // that one is a Laptop line
  });
});

/**
 * Scoping is not one of the filters: a manager cannot widen their report by
 * leaving the team filter off.
 */
describe("a report never shows another team", () => {
  it("excludes another team from a manager report", async () => {
    const report = await runSalesReport({
      user: manager,
      filters: { approvalStates: ["PENDING_FINANCE"] },
    });

    const ids = report.rows.map((r) => r.quotationId);
    expect(ids).toContain(pendingFinanceId); // their own team
    expect(ids).not.toContain(southQuotationId); // someone else team
  });

  it("shows Admin both", async () => {
    const report = await runSalesReport({
      user: admin,
      filters: { approvalStates: ["PENDING_FINANCE"] },
    });

    const ids = report.rows.map((r) => r.quotationId);
    expect(ids).toContain(pendingFinanceId);
    expect(ids).toContain(southQuotationId);
  });

  it("is refused to a Sales Rep", async () => {
    await expect(runSalesReport({ user: rep })).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("aggregates", () => {
  it("totals and counts what it returned", async () => {
    const report = await runSalesReport({
      user: admin,
      filters: {
        salesRepId: priyaId,
        approvalStates: ["PENDING_FINANCE", "APPROVED"],
        from: recently(),
      },
    });

    // The totals describe the returned rows, whatever they are - that is the
    // invariant worth asserting, rather than a count that depends on seed data.
    expect(report.totals.quotations).toBe(report.rows.length);
    expect(report.totals.byApprovalState.APPROVED).toBe(1);
    expect(report.totals.byApprovalState.PENDING_FINANCE).toBe(1);
    expect(Number(report.totals.totalAmount)).toBeGreaterThan(0);
  });

  it("reports zeroes rather than failing on an empty result", async () => {
    const report = await runSalesReport({
      user: admin,
      filters: { salesRepId: "no-such-rep" },
    });

    expect(report.rows).toEqual([]);
    expect(report.totals.quotations).toBe(0);
    expect(report.totals.totalAmount).toBe("0.00");
    expect(report.totals.averageMarginPercentage).toBe("0.00");
  });
});

/**
 * The failure this guards against: a screen showing one row and a download
 * containing everything.
 */
describe("export reflects the applied filter", () => {
  const filters = { approvalStates: ["PENDING_FINANCE" as const], salesRepId: undefined };

  it("writes only the filtered rows to CSV", async () => {
    const filtered = await exportSalesReport({
      user: admin,
      filters: { approvalStates: ["PENDING_FINANCE"], salesRepId: priyaId },
      format: "CSV",
    });
    const text = filtered.body.toString("utf8");

    expect(filtered.rowCount).toBe(1);
    expect(text).toContain((await quoteNumberOf(pendingFinanceId)) as string);
    expect(text).not.toContain((await quoteNumberOf(approvedId)) as string);
  });

  it("writes only the filtered rows to XLS", async () => {
    const filtered = await exportSalesReport({
      user: admin,
      filters: { approvalStates: ["PENDING_FINANCE"], salesRepId: priyaId },
      format: "XLS",
    });
    const xml = filtered.body.toString("utf8");

    expect(filtered.filename).toMatch(/\.xls$/);
    expect(filtered.contentType).toBe("application/vnd.ms-excel");
    expect(xml).toContain("<Workbook");
    expect(xml).toContain((await quoteNumberOf(pendingFinanceId)) as string);
    expect(xml).not.toContain((await quoteNumberOf(approvedId)) as string);
  });

  it("produces a real PDF, filtered", async () => {
    const filtered = await exportSalesReport({
      user: admin,
      filters: { approvalStates: ["PENDING_FINANCE"], salesRepId: priyaId },
      format: "PDF",
    });

    expect(filtered.filename).toMatch(/\.pdf$/);
    expect(filtered.contentType).toBe("application/pdf");
    // A genuine PDF, not a text file with the wrong extension.
    expect(filtered.body.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    expect(filtered.body.subarray(-6).toString("ascii")).toContain("%%EOF");
    expect(filtered.rowCount).toBe(1);
  });

  it("exports more rows when the filter is widened", async () => {
    const narrow = await exportSalesReport({
      user: admin,
      filters: { approvalStates: ["PENDING_FINANCE"], salesRepId: priyaId },
      format: "CSV",
    });
    const wide = await exportSalesReport({
      user: admin,
      filters: { salesRepId: priyaId },
      format: "CSV",
    });

    expect(wide.rowCount).toBeGreaterThan(narrow.rowCount);
  });

  // A PDF gets passed around detached from the screen that produced it.
  it("prints the applied filters onto the export itself", async () => {
    const csv = await exportSalesReport({
      user: admin,
      filters: { approvalStates: ["PENDING_FINANCE"] },
      format: "CSV",
    });

    expect(csv.body.toString("utf8")).toContain("Approval status: PENDING_FINANCE");
    expect(filters.approvalStates).toEqual(["PENDING_FINANCE"]);
  });

  it("applies the caller scope to the export, not just the screen", async () => {
    const managerExport = await exportSalesReport({
      user: manager,
      filters: { approvalStates: ["PENDING_FINANCE"] },
      format: "CSV",
    });
    const text = managerExport.body.toString("utf8");

    expect(text).not.toContain((await quoteNumberOf(southQuotationId)) as string);
  });
});

/** A window tight enough to exclude the seeded historical orders. */
function recently(): Date {
  return new Date(currentBusinessTime().getTime() - DAY_MS);
}

async function quoteNumberOf(quotationId: string): Promise<string> {
  const q = await prisma.quotation.findUniqueOrThrow({
    where: { id: quotationId },
    select: { quoteNumber: true },
  });
  return q.quoteNumber;
}
