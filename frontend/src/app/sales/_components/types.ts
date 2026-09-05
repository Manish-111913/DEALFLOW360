/**
 * What the Sales Workspace server component hands its client half.
 *
 * Prisma Decimals and Dates are flattened to strings on the server, because
 * neither crosses into a client component intact.
 */

export type PipelineStage =
  | "DRAFT"
  | "PENDING_APPROVAL"
  | "NEGOTIATION"
  | "APPROVED"
  | "FULFILLMENT"
  | "CLOSED";

export interface DealRow {
  id: string;
  quoteNumber: string;
  customerName: string;
  salesRepName: string;
  stage: PipelineStage;
  status: string;
  approvalState: string;
  totalAmount: string;
  marginPercentage: string;
  riskScore: string;
  riskLevel: string;
  lineCount: number;
  lastActivityAt: string;
}

export interface PipelineSummary {
  stages: { stage: string; count: number; value: string }[];
  totalDeals: number;
  totalValue: string;
}

export interface BuilderLine {
  id: string;
  productName: string;
  sku: string;
  quantity: number;
  unitPrice: string;
  discountPercentage: number;
  lineTotal: string;
  /** Added from the recommendation panel rather than typed in by the rep. */
  isUpsell: boolean;
}

export interface UpsellCard {
  productId: string;
  productName: string;
  /** The engine's own grounding, e.g. "72% of similar orders include this". */
  reason: string;
  score: string;
  marginImpact: string;
  marginPercentage: string;
  isPromoted: boolean;
  suggestedQuantity: number;
}

export interface BuilderData {
  quotationId: string;
  quoteNumber: string;
  customerName: string;
  customerTier: string | null;
  status: string;
  approvalState: string;
  subtotal: string;
  discountAmount: string;
  taxAmount: string;
  totalAmount: string;
  marginPercentage: string;
  riskScore: string;
  lines: BuilderLine[];
  upsell: UpsellCard[];
}
