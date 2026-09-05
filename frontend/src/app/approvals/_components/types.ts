/**
 * What the Approvals server component hands its client half.
 *
 * Prisma returns Decimal and Date, and neither survives the boundary into a
 * client component intact - Decimal arrives as a plain object, Date as a
 * string, and both silently. So the page flattens everything to primitives here
 * and this file is the contract for that.
 */

export interface ApprovalLine {
  id: string;
  productName: string;
  sku: string;
  quantity: number;
  unitPrice: string;
  lineTotal: string;
  discountPercentage: number;
  /** The ceiling this line was checked against, as resolved when it was priced. */
  discountCeiling: number;
  /** Above zero means this line is what triggered the exception. */
  violationPoints: number;
}

export interface ApprovalFactor {
  id: string;
  source: string;
  points: number;
  /** D22: the engine explains itself, so the screen does not have to guess. */
  description: string;
  formula: string;
}

export interface ApprovalRequestRow {
  id: string;
  status: string;
  stepOrder: number;
  stepName: string;
  approverRole: string;
  triggerReason: string;
  decisionReason: string | null;
  requestedAt: string;
  actedAt: string | null;
  /**
   * "24m ago", computed on the server from `currentBusinessTime()`.
   *
   * D3 says business time is read in exactly one place. A client component
   * reading the host clock would break that and would also ignore a
   * time-travelled demo clock, so the age is measured where the business clock
   * lives and sent across as text.
   */
  requestedAgo: string;
}

export interface ApprovalScreenData {
  quotationId: string;
  quoteNumber: string;
  approvalState: string;
  riskScore: number;
  riskLevel: string;
  customerName: string;
  customerTier: string | null;
  salesRepName: string;
  totalAmount: string;
  marginPercentage: string;
  subtotal: string;
  discountAmount: string;
  validUntil: string | null;
  lines: ApprovalLine[];
  factors: ApprovalFactor[];
  requests: ApprovalRequestRow[];
}

/** One entry in the "other quotations waiting" list. */
export interface QueueEntry {
  id: string;
  quoteNumber: string;
  customerName: string;
  totalAmount: string;
  riskScore: string;
}
