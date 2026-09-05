import { Prisma } from "../generated/prisma/client";
import { currentBusinessTime } from "../clock";
import { prisma } from "../db";
import { NotFoundError } from "../errors";
import type { LineTerms } from "../engines/negotiation";

/**
 * D5 - append-only quotation snapshots.
 *
 * "The last approved snapshot" is not a separate JSON blob kept in step with
 * the quotation by hand; it is simply the most recent version row carrying an
 * `approvedAt`. That removes a whole class of bug where the mirror and the
 * thing it mirrors quietly disagree.
 *
 * Versions are never updated or deleted. A negotiation, an approval and a
 * revision each add a row, so the manager re-approving a quote can be shown a
 * real diff rather than being asked to remember.
 */

const Decimal = Prisma.Decimal;

/** One line as it stood at a point in time. */
export interface LineSnapshot {
  lineId: string;
  productName: string;
  quantity: number;
  unitPrice: string;
  discountPercentage: string;
  discountCeiling: string;
  lineTotal: string;
}

export interface SnapshotResult {
  versionId: string;
  versionNumber: number;
}

export async function snapshotQuotation(params: {
  quotationId: string;
  reason: string;
  createdById?: string | null;
  /** Set when this version is the one a reviewer signed off. */
  approved?: boolean;
  tx?: Prisma.TransactionClient;
}): Promise<SnapshotResult> {
  const db = params.tx ?? prisma;

  const quotation = await db.quotation.findUnique({
    where: { id: params.quotationId },
    include: {
      lines: {
        orderBy: { sequence: "asc" },
        include: { product: { select: { name: true } } },
      },
    },
  });
  if (!quotation) throw new NotFoundError(`Quotation ${params.quotationId} does not exist`);

  const previous = await db.quotationVersion.findFirst({
    where: { quotationId: params.quotationId },
    orderBy: { versionNumber: "desc" },
    select: { versionNumber: true },
  });
  const versionNumber = (previous?.versionNumber ?? 0) + 1;

  const lineSnapshot: LineSnapshot[] = quotation.lines.map((l) => ({
    lineId: l.id,
    productName: l.product.name,
    quantity: l.quantity,
    unitPrice: l.unitPrice.toFixed(2),
    discountPercentage: l.discountPercentage.toFixed(2),
    discountCeiling: l.discountCeiling.toFixed(2),
    lineTotal: l.lineTotal.toFixed(2),
  }));

  const now = currentBusinessTime();
  const version = await db.quotationVersion.create({
    data: {
      quotationId: params.quotationId,
      versionNumber,
      createdById: params.createdById ?? null,
      reason: params.reason,
      subtotal: quotation.subtotal,
      discountAmount: quotation.discountAmount,
      totalAmount: quotation.totalAmount,
      totalCost: quotation.totalCost,
      grossMargin: quotation.grossMargin,
      marginPercentage: quotation.marginPercentage,
      riskScore: quotation.riskScore,
      lineSnapshot: lineSnapshot as unknown as Prisma.InputJsonValue,
      approvedAt: params.approved ? now : null,
      createdAt: now,
    },
  });

  return { versionId: version.id, versionNumber };
}

export interface ApprovedSnapshot {
  versionId: string;
  versionNumber: number;
  riskScore: number;
  lines: LineTerms[];
  approvedAt: Date;
}

/** The terms a human actually signed off, or null if none ever were. */
export async function lastApprovedSnapshot(
  quotationId: string,
): Promise<ApprovedSnapshot | null> {
  const version = await prisma.quotationVersion.findFirst({
    where: { quotationId, approvedAt: { not: null } },
    orderBy: { approvedAt: "desc" },
  });
  if (!version) return null;

  const lines = (version.lineSnapshot as unknown as LineSnapshot[]) ?? [];

  return {
    versionId: version.id,
    versionNumber: version.versionNumber,
    riskScore: version.riskScore.toNumber(),
    approvedAt: version.approvedAt as Date,
    lines: lines.map((l) => ({
      lineId: l.lineId,
      label: l.productName,
      discountPercentage: new Decimal(l.discountPercentage),
      discountCeiling: new Decimal(l.discountCeiling),
    })),
  };
}

/** Full version history, oldest first, for the re-approval diff. */
export async function versionHistory(quotationId: string) {
  return prisma.quotationVersion.findMany({
    where: { quotationId },
    orderBy: { versionNumber: "asc" },
    include: { createdBy: { select: { id: true, name: true } } },
  });
}
