import PDFDocument from "pdfkit";
import { Prisma } from "../generated/prisma/client";
import type { ApprovalState, RiskLevel } from "../generated/prisma/enums";
import { assertCan, type AuthzUser } from "../authz/roles";
import { scopeFor } from "../authz/scope";
import { currentBusinessTime } from "../clock";
import { prisma } from "../db";
import { getSettings } from "../settings";

/**
 * Sales reporting.
 *
 * ---------------------------------------------------------------------------
 * FOUR FILTERS THAT COMPOSE
 * ---------------------------------------------------------------------------
 * §A7 names period, sales team or rep, approval status, and product or
 * category. They are combined with AND, not offered as mutually exclusive
 * tabs - which is how a manager actually narrows a question: "this quarter's
 * pending-finance quotes for Hardware, on my team".
 *
 * ---------------------------------------------------------------------------
 * THE EXPORT IS THE SAME QUERY
 * ---------------------------------------------------------------------------
 * Every export runs `runSalesReport` and formats what comes back. It is
 * structurally incapable of exporting the unfiltered dataset, which is the
 * failure mode the acceptance calls out - a screen showing ten rows and a
 * download containing four hundred.
 *
 * ---------------------------------------------------------------------------
 * SCOPING IS NOT A FILTER
 * ---------------------------------------------------------------------------
 * The caller's own visibility comes from `scopeFor` and is AND-ed in
 * separately, so a Sales Manager cannot widen their report by omitting the team
 * filter. Reports respect the same record scoping as the quotations behind them.
 */

const Decimal = Prisma.Decimal;

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

export interface ReportFilters {
  /** Period, on quotation creation date. Either bound may stand alone. */
  from?: Date | null;
  to?: Date | null;
  salesRepId?: string | null;
  salesTeamId?: string | null;
  approvalStates?: ApprovalState[] | null;
  productId?: string | null;
  categoryId?: string | null;
}

function buildWhere(filters: ReportFilters): Prisma.QuotationWhereInput {
  const clauses: Prisma.QuotationWhereInput[] = [];

  if (filters.from || filters.to) {
    clauses.push({
      createdAt: {
        ...(filters.from ? { gte: filters.from } : {}),
        ...(filters.to ? { lte: filters.to } : {}),
      },
    });
  }

  if (filters.salesRepId) clauses.push({ salesRepId: filters.salesRepId });
  if (filters.salesTeamId) clauses.push({ salesRep: { salesTeamId: filters.salesTeamId } });

  if (filters.approvalStates && filters.approvalStates.length > 0) {
    clauses.push({ approvalState: { in: filters.approvalStates } });
  }

  // A product or category filter asks "which quotations touch this", so it
  // matches on the existence of a line rather than reshaping the row set.
  if (filters.productId) {
    clauses.push({ lines: { some: { productId: filters.productId } } });
  }
  if (filters.categoryId) {
    clauses.push({ lines: { some: { product: { categoryId: filters.categoryId } } } });
  }

  return clauses.length > 0 ? { AND: clauses } : {};
}

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

export interface ReportRow {
  quotationId: string;
  quoteNumber: string;
  customerName: string;
  salesRepName: string;
  salesTeamName: string | null;
  status: string;
  approvalState: ApprovalState;
  riskScore: number;
  riskLevel: RiskLevel;
  subtotal: string;
  discountAmount: string;
  totalAmount: string;
  grossMargin: string;
  marginPercentage: string;
  lineCount: number;
  createdAt: Date;
}

export interface ReportTotals {
  quotations: number;
  subtotal: string;
  discountAmount: string;
  totalAmount: string;
  grossMargin: string;
  averageMarginPercentage: string;
  averageRiskScore: string;
  byApprovalState: Record<string, number>;
  byRiskLevel: Record<string, number>;
}

export interface SalesReport {
  rows: ReportRow[];
  totals: ReportTotals;
  /** Echoed so an export can print what it was filtered by. */
  appliedFilters: string[];
  generatedAt: Date;
  currency: string;
}

function describeFilters(filters: ReportFilters): string[] {
  const described: string[] = [];
  if (filters.from || filters.to) {
    described.push(
      `Period: ${filters.from?.toISOString().slice(0, 10) ?? "any"} to ${filters.to?.toISOString().slice(0, 10) ?? "any"}`,
    );
  }
  if (filters.salesRepId) described.push(`Sales rep: ${filters.salesRepId}`);
  if (filters.salesTeamId) described.push(`Sales team: ${filters.salesTeamId}`);
  if (filters.approvalStates?.length) {
    described.push(`Approval status: ${filters.approvalStates.join(", ")}`);
  }
  if (filters.productId) described.push(`Product: ${filters.productId}`);
  if (filters.categoryId) described.push(`Category: ${filters.categoryId}`);
  return described.length > 0 ? described : ["No filters applied"];
}

export async function runSalesReport(params: {
  user: AuthzUser;
  filters?: ReportFilters;
}): Promise<SalesReport> {
  assertCan(params.user, "view", "report");

  const settings = await getSettings();
  const { currencyCode } = settings;

  /**
   * Configured defaults fill in only what the caller did not ask for.
   *
   * A report run with no period would otherwise scan the whole history, which
   * is rarely what anyone means. The Settings screen sets the window and the
   * approval states, and an explicit filter always wins - so the defaults shape
   * the unspecified case rather than overriding a deliberate one.
   */
  const requested = params.filters ?? {};
  const noPeriod = !requested.from && !requested.to;
  const filters: ReportFilters = {
    ...requested,
    from:
      requested.from ??
      (noPeriod
        ? new Date(
            currentBusinessTime().getTime() -
              settings.reportingDefaultPeriodDays * 86_400_000,
          )
        : null),
    approvalStates:
      requested.approvalStates ??
      (settings.reportingDefaultStates.length > 0
        ? (settings.reportingDefaultStates as ApprovalState[])
        : null),
  };

  // Two independent gates: what the caller asked for, and what they may see.
  const quotations = await prisma.quotation.findMany({
    where: { AND: [buildWhere(filters), scopeFor(params.user, "Quotation")] },
    include: {
      customer: { select: { name: true } },
      salesRep: { select: { name: true, salesTeam: { select: { name: true } } } },
      _count: { select: { lines: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const rows: ReportRow[] = quotations.map((q) => ({
    quotationId: q.id,
    quoteNumber: q.quoteNumber,
    customerName: q.customer.name,
    salesRepName: q.salesRep.name,
    salesTeamName: q.salesRep.salesTeam?.name ?? null,
    status: q.status,
    approvalState: q.approvalState,
    riskScore: q.riskScore.toNumber(),
    riskLevel: q.riskLevel,
    subtotal: q.subtotal.toFixed(2),
    discountAmount: q.discountAmount.toFixed(2),
    totalAmount: q.totalAmount.toFixed(2),
    grossMargin: q.grossMargin.toFixed(2),
    marginPercentage: q.marginPercentage.toFixed(2),
    lineCount: q._count.lines,
    createdAt: q.createdAt,
  }));

  const zero = new Decimal(0);
  const sum = (pick: (q: (typeof quotations)[number]) => Prisma.Decimal) =>
    quotations.reduce((acc, q) => acc.plus(pick(q)), zero);

  const byApprovalState: Record<string, number> = {};
  const byRiskLevel: Record<string, number> = {};
  for (const q of quotations) {
    byApprovalState[q.approvalState] = (byApprovalState[q.approvalState] ?? 0) + 1;
    byRiskLevel[q.riskLevel] = (byRiskLevel[q.riskLevel] ?? 0) + 1;
  }

  const count = quotations.length;
  const averageMargin = count
    ? sum((q) => q.marginPercentage).dividedBy(count)
    : zero;
  const averageRisk = count ? sum((q) => q.riskScore).dividedBy(count) : zero;

  return {
    rows,
    totals: {
      quotations: count,
      subtotal: sum((q) => q.subtotal).toFixed(2),
      discountAmount: sum((q) => q.discountAmount).toFixed(2),
      totalAmount: sum((q) => q.totalAmount).toFixed(2),
      grossMargin: sum((q) => q.grossMargin).toFixed(2),
      averageMarginPercentage: averageMargin.toFixed(2),
      averageRiskScore: averageRisk.toFixed(2),
      byApprovalState,
      byRiskLevel,
    },
    appliedFilters: describeFilters(filters),
    generatedAt: currentBusinessTime(),
    currency: currencyCode,
  };
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export type ExportFormat = "CSV" | "XLS" | "PDF";

export interface ExportedReport {
  filename: string;
  contentType: string;
  body: Buffer;
  /** Rows written, so a caller can confirm the export matched the screen. */
  rowCount: number;
}

const COLUMNS: { header: string; value: (r: ReportRow) => string }[] = [
  { header: "Quote", value: (r) => r.quoteNumber },
  { header: "Customer", value: (r) => r.customerName },
  { header: "Sales rep", value: (r) => r.salesRepName },
  { header: "Team", value: (r) => r.salesTeamName ?? "" },
  { header: "Status", value: (r) => r.status },
  { header: "Approval", value: (r) => r.approvalState },
  { header: "Risk", value: (r) => String(r.riskScore) },
  { header: "Risk level", value: (r) => r.riskLevel },
  { header: "Subtotal", value: (r) => r.subtotal },
  { header: "Discount", value: (r) => r.discountAmount },
  { header: "Total", value: (r) => r.totalAmount },
  { header: "Margin", value: (r) => r.grossMargin },
  { header: "Margin %", value: (r) => r.marginPercentage },
];

/**
 * Export the report.
 *
 * Runs the same query the screen ran, with the same filters and the same
 * scoping, then formats it. There is no path here that can reach unfiltered
 * data.
 */
export async function exportSalesReport(params: {
  user: AuthzUser;
  filters?: ReportFilters;
  format: ExportFormat;
}): Promise<ExportedReport> {
  const report = await runSalesReport({ user: params.user, filters: params.filters });
  const stamp = report.generatedAt.toISOString().slice(0, 10);

  if (params.format === "CSV") {
    return {
      filename: `sales-report-${stamp}.csv`,
      contentType: "text/csv; charset=utf-8",
      body: Buffer.from(toCsv(report), "utf8"),
      rowCount: report.rows.length,
    };
  }

  if (params.format === "XLS") {
    return {
      filename: `sales-report-${stamp}.xls`,
      contentType: "application/vnd.ms-excel",
      body: Buffer.from(toSpreadsheetML(report), "utf8"),
      rowCount: report.rows.length,
    };
  }

  return {
    filename: `sales-report-${stamp}.pdf`,
    contentType: "application/pdf",
    body: await toPdf(report),
    rowCount: report.rows.length,
  };
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function toCsv(report: SalesReport): string {
  const lines: string[] = [];
  lines.push(COLUMNS.map((c) => csvCell(c.header)).join(","));
  for (const row of report.rows) {
    lines.push(COLUMNS.map((c) => csvCell(c.value(row))).join(","));
  }
  lines.push("");
  lines.push(csvCell(`Quotations: ${report.totals.quotations}`));
  lines.push(csvCell(`Total: ${report.totals.totalAmount} ${report.currency}`));
  for (const filter of report.appliedFilters) lines.push(csvCell(filter));
  return lines.join("\n");
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * SpreadsheetML - the XML workbook format Excel has opened natively since 2003.
 *
 * Chosen over a CSV renamed to .xls because that is a lie a spreadsheet
 * eventually complains about, and over a real XLSX because that needs a zip
 * writer and a dependency for no gain at this size.
 */
function toSpreadsheetML(report: SalesReport): string {
  const headerCells = COLUMNS.map(
    (c) => `<Cell><Data ss:Type="String">${xmlEscape(c.header)}</Data></Cell>`,
  ).join("");

  const bodyRows = report.rows
    .map((row) => {
      const cells = COLUMNS.map((c) => {
        const raw = c.value(row);
        const numeric = raw !== "" && !Number.isNaN(Number(raw));
        return numeric
          ? `<Cell><Data ss:Type="Number">${xmlEscape(raw)}</Data></Cell>`
          : `<Cell><Data ss:Type="String">${xmlEscape(raw)}</Data></Cell>`;
      }).join("");
      return `<Row>${cells}</Row>`;
    })
    .join("");

  const filterRows = report.appliedFilters
    .map((f) => `<Row><Cell><Data ss:Type="String">${xmlEscape(f)}</Data></Cell></Row>`)
    .join("");

  return `<?xml version="1.0"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
          xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Worksheet ss:Name="Sales report">
    <Table>
      <Row>${headerCells}</Row>
      ${bodyRows}
      <Row></Row>
      <Row><Cell><Data ss:Type="String">Quotations</Data></Cell><Cell><Data ss:Type="Number">${report.totals.quotations}</Data></Cell></Row>
      <Row><Cell><Data ss:Type="String">Total</Data></Cell><Cell><Data ss:Type="Number">${report.totals.totalAmount}</Data></Cell></Row>
      <Row></Row>
      ${filterRows}
    </Table>
  </Worksheet>
</Workbook>`;
}

function toPdf(report: SalesReport): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 36 });
    const chunks: Buffer[] = [];

    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(16).text("DealFlow360 - Sales report", { continued: false });
    doc.moveDown(0.3);
    doc.fontSize(9).fillColor("#555");
    doc.text(`Generated ${report.generatedAt.toISOString().slice(0, 19).replace("T", " ")}`);
    // The filters are printed on the document itself, so a PDF passed around
    // cannot be mistaken for the whole dataset.
    for (const filter of report.appliedFilters) doc.text(filter);
    doc.fillColor("#000").moveDown(0.6);

    const columnWidth = (doc.page.width - 72) / COLUMNS.length;
    const writeRow = (values: string[], bold: boolean) => {
      const top = doc.y;
      values.forEach((value, index) => {
        doc
          .font(bold ? "Helvetica-Bold" : "Helvetica")
          .fontSize(7)
          .text(value, 36 + index * columnWidth, top, {
            width: columnWidth - 4,
            ellipsis: true,
            lineBreak: false,
          });
      });
      doc.y = top + 12;
    };

    writeRow(COLUMNS.map((c) => c.header), true);
    for (const row of report.rows) {
      if (doc.y > doc.page.height - 60) {
        doc.addPage();
        writeRow(COLUMNS.map((c) => c.header), true);
      }
      writeRow(COLUMNS.map((c) => c.value(row)), false);
    }

    doc.moveDown(0.8);
    doc
      .font("Helvetica-Bold")
      .fontSize(9)
      .text(
        `${report.totals.quotations} quotations - total ${report.totals.totalAmount} ${report.currency} - average margin ${report.totals.averageMarginPercentage}%`,
        36,
        doc.y,
      );

    doc.end();
  });
}
