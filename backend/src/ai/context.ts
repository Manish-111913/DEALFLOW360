import { can, type AuthzUser } from "../authz/roles";
import { prisma } from "../db";
import { getApprovalOverview } from "../services/approvals";
import { getBillingSchedule } from "../services/billing";
import { scoreDealHealth } from "../services/deal-health";
import { resolveCeilings } from "../services/discount-policy";
import { getFulfillmentView } from "../services/fulfillment";
import { getNegotiationHistory } from "../services/portal";
import { getQuotation, listQuotations, stageOf } from "../services/quotations";
import { getUpsellSuggestions } from "../services/upsell";
import { AiError } from "./gemini";

/**
 * Everything the assistant is allowed to know, assembled from real services.
 *
 * Two rules shape this file.
 *
 * The first is that nothing here is invented or passed in from the browser. The
 * client says which screen it is on and which deal is open; every number comes
 * back out of the same services the screens themselves render. A question about
 * margin is answered from the margin the engine computed, not from a model's
 * arithmetic.
 *
 * The second is that access is not re-implemented. Each section calls the
 * service that already enforces its own capability, so a SALES_REP building
 * context simply has no deal-health section - the same authorisation that hides
 * the board from them hides it from the model, and there is no second copy of
 * the rules to drift.
 */

/** A section that the caller's role does not permit is absent, not empty. */
async function optional<T>(allowed: boolean, load: () => Promise<T>): Promise<T | null> {
  if (!allowed) return null;
  try {
    return await load();
  } catch {
    // A missing plan or schedule is a normal state, not a failure of the
    // assistant. The section is simply not part of this deal's context.
    return null;
  }
}

export interface DealContext {
  quotationId: string;
  quoteNumber: string;
  customerName: string;
  /// Nullable by design: a tier-less customer skips ceiling checks, which
  /// is exactly the sort of thing the assistant should be able to say.
  customerTier: string | null;
  salesRepName: string;
  stage: string;
  status: string;
  approvalState: string;
  currency: string;
  totals: {
    subtotal: string;
    discountAmount: string;
    taxAmount: string;
    totalAmount: string;
    totalCost: string | null;
    grossMargin: string | null;
    marginPercentage: string | null;
  };
  risk: { score: string; level: string } | null;
  negotiationCount: number;
  validUntil: string | null;
  lastActivityAt: string;
  lines: {
    /// The real database id. Never shown to the model - scenario proposals
    /// address lines by index, and the index is mapped back here.
    lineId: string;
    productName: string;
    sku: string;
    quantity: number;
    unitPrice: string;
    discountPercentage: string;
    discountCeiling: string | null;
    overCeilingBy: string | null;
    lineTotal: string;
    marginPercentage: string | null;
  }[];
  approval: {
    requests: { status: string; approverRole: string; decidedAt: string | null; reason: string | null }[];
    factors: { label: string; points: string; source: string }[];
  } | null;
  health: {
    score: number;
    severity: string;
    recommendedAction: string;
    stalledDays: number | null;
    explain: { label: string; value: string; steps: { label: string; formula: string; value: string }[] };
  } | null;
  fulfillment: {
    recommendedShipments: number | null;
    shippingCost: string | null;
    rationale: string | null;
    allocations: { productName: string; warehouseName: string; allocated: number; requested: number }[];
    backorders: { productName: string; quantity: number; status: string }[];
  } | null;
  billing: {
    oneTimeLines: number;
    subscriptions: { productName: string; quantity: number; amount: string; interval: string; status: string }[];
    invoices: { number: string; type: string; status: string; total: string }[];
  } | null;
  negotiation: {
    round: number;
    status: string;
    requests: { type: string; requestedValue: string | null; reason: string | null; status: string; at: string }[];
    comments: { message: string; at: string; fromCustomer: boolean }[];
  } | null;
  /// `productId` is for mapping a proposal back to a real product; like
  /// lineId it is never shown to the model.
  upsell:
    | { productId: string; productName: string; reason: string; additionalRevenue: string | null }[]
    | null;
}

/**
 * Build the full picture of one deal for the caller.
 *
 * Throws `no_context` rather than returning a hollow object: a card that says
 * "not enough information" is honest, whereas one built from an empty context
 * would look like an answer.
 */
export async function buildDealContext(
  user: AuthzUser,
  quotationId: string,
): Promise<DealContext> {
  if (user.kind === "PORTAL") {
    // D20. The assistant is an internal surface; the customer's is the portal.
    throw new AiError("no_context", "Deal Intelligence is not available on the portal");
  }

  const quotation = await getQuotation(user, quotationId);
  if (!quotation) throw new AiError("no_context", `Quotation ${quotationId} does not exist`);

  const ceilings = await resolveCeilings(
    quotation.customer.tier,
    quotation.lines.map((line) => line.product.categoryId),
  );

  const [approval, health, fulfillment, billing, negotiations, upsell] = await Promise.all([
    optional(can(user, "view", "riskDetail"), () => getApprovalOverview(user, quotationId)),
    optional(can(user, "view", "dealHealth"), () => scoreDealHealth(quotationId)),
    optional(can(user, "view", "fulfilmentProgress"), () => getFulfillmentView(user, quotationId)),
    optional(can(user, "view", "billingSchedule"), () => getBillingSchedule(user, quotationId)),
    optional(true, () => getNegotiationHistory(quotationId)),
    optional(true, () => getUpsellSuggestions(quotationId)),
  ]);

  const stalled = health
    ? await prisma.dealHealthSnapshot
        .findFirst({ where: { quotationId }, orderBy: { computedAt: "desc" } })
        .then((snapshot) => snapshot?.stalledDays ?? null)
    : null;

  const latestNegotiation = negotiations?.at(-1) ?? null;
  const negotiationRound = negotiations?.length ?? 0;
  const recommendedPlan = fulfillment?.recommended ?? null;

  return {
    quotationId: quotation.id,
    quoteNumber: quotation.quoteNumber,
    customerName: quotation.customer.name,
    customerTier: quotation.customer.tier,
    salesRepName: quotation.salesRep.name,
    stage: stageOf({
      status: quotation.status,
      approvalState: quotation.approvalState,
      negotiationCount: quotation.negotiationCount,
    }),
    status: quotation.status,
    approvalState: quotation.approvalState,
    currency: quotation.currency ?? "INR",
    totals: {
      subtotal: quotation.subtotal.toFixed(2),
      discountAmount: quotation.discountAmount.toFixed(2),
      taxAmount: quotation.taxAmount.toFixed(2),
      totalAmount: quotation.totalAmount.toFixed(2),
      totalCost: quotation.totalCost?.toFixed(2) ?? null,
      grossMargin: quotation.grossMargin?.toFixed(2) ?? null,
      marginPercentage: quotation.marginPercentage?.toFixed(2) ?? null,
    },
    risk: { score: quotation.riskScore.toFixed(2), level: quotation.riskLevel },
    negotiationCount: quotation.negotiationCount,
    validUntil: quotation.validUntil?.toISOString() ?? null,
    lastActivityAt: quotation.lastActivityAt.toISOString(),

    lines: quotation.lines.map((line) => {
      const ceiling = ceilings.get(line.product.categoryId)?.ceiling ?? null;
      const over =
        ceiling && line.discountPercentage.greaterThan(ceiling)
          ? line.discountPercentage.minus(ceiling).toFixed(2)
          : null;
      return {
        lineId: line.id,
        productName: line.product.name,
        sku: line.product.sku,
        quantity: line.quantity,
        unitPrice: line.unitPrice.toFixed(2),
        discountPercentage: line.discountPercentage.toFixed(2),
        discountCeiling: ceiling?.toFixed(2) ?? null,
        overCeilingBy: over,
        lineTotal: line.lineTotal.toFixed(2),
        marginPercentage: line.marginPercentage?.toFixed(2) ?? null,
      };
    }),

    approval: approval
      ? {
          requests: approval.requests.map((request) => ({
            status: request.status,
            approverRole: request.step.approverRole,
            decidedAt: request.actedAt?.toISOString() ?? null,
            // The trigger explains why it was raised; the decision reason
            // explains why it was sent back. Both matter to a summary.
            reason: request.decisionReason ?? request.triggerReason,
          })),
          factors: approval.factors.map((factor) => ({
            label: factor.description,
            points: factor.points.toFixed(2),
            source: factor.source,
          })),
        }
      : null,

    health: health
      ? {
          score: health.healthScore,
          severity: health.severity,
          recommendedAction: health.recommendedAction,
          stalledDays: stalled,
          explain: {
            label: health.explain.label,
            value: health.explain.value,
            steps: health.explain.steps,
          },
        }
      : null,

    fulfillment: fulfillment
      ? {
          recommendedShipments: recommendedPlan?.shipmentCount ?? null,
          shippingCost: recommendedPlan?.shippingCost ?? null,
          rationale: recommendedPlan?.rationale ?? null,
          allocations: fulfillment.allocations.map((allocation) => ({
            productName: allocation.productName,
            warehouseName: allocation.warehouseName,
            allocated: allocation.allocatedQuantity,
            requested: allocation.requestedQuantity,
          })),
          backorders: fulfillment.backorders.map((backorder) => ({
            productName: backorder.productName,
            quantity: backorder.quantity,
            status: backorder.status,
          })),
        }
      : null,

    billing: billing
      ? {
          oneTimeLines: billing.oneTime.length,
          subscriptions: billing.recurring.map((subscription) => ({
            productName: subscription.productName,
            quantity: subscription.quantity,
            amount: subscription.unitPrice.toFixed(2),
            interval: subscription.interval,
            status: subscription.status,
          })),
          // BillingScheduleView carries the invoice status per one-time line
          // rather than a separate invoice list, so that is what is reported.
          invoices: billing.oneTime
            .filter((line) => line.invoiceId !== null)
            .map((line) => ({
              number: line.invoiceId ?? "",
              type: "ONE_TIME",
              status: line.invoiceStatus ?? "UNKNOWN",
              total: line.lineTotal.toFixed(2),
            })),
        }
      : null,

    negotiation: latestNegotiation
      ? {
          round: negotiationRound,
          status: latestNegotiation.status,
          requests: latestNegotiation.requests.map((request) => ({
            type: request.requestType,
            requestedValue: request.requestedValue?.toFixed(2) ?? null,
            reason: request.reason ?? null,
            status: request.status,
            at: request.createdAt.toISOString(),
          })),
          comments: latestNegotiation.comments.map((comment) => ({
            message: comment.message,
            at: comment.createdAt.toISOString(),
            // A comment with no internal author came from the customer.
            fromCustomer: comment.authorId === null,
          })),
        }
      : null,

    upsell:
      upsell?.map((suggestion) => ({
        productId: suggestion.productId,
        productName: suggestion.productName,
        reason: suggestion.reason,
        // The engine reports margin impact; calling it revenue would be a
        // different number, and the assistant must not blur the two.
        additionalRevenue: suggestion.marginImpact.toFixed(2),
      })) ?? null,
  };
}

/**
 * The deal, as a compact block for the prompt.
 *
 * Rendered as labelled lines rather than raw JSON: it costs fewer tokens, and a
 * model reads "Discount ceiling: 10.00 (over by 8.00)" more reliably than it
 * reads the same thing spread across nested objects.
 */
export function renderDealContext(context: DealContext): string {
  const out: string[] = [];
  const money = (value: string | null) => (value === null ? "unknown" : `${context.currency} ${value}`);

  out.push(
    `DEAL ${context.quoteNumber} - ${context.customerName} (${
      context.customerTier ? `${context.customerTier} tier` : "NO TIER SET - discount ceilings are not applied"
    })`,
  );
  out.push(`Owner: ${context.salesRepName}`);
  out.push(`Stage: ${context.stage} | Status: ${context.status} | Approval: ${context.approvalState}`);
  out.push(
    `Total: ${money(context.totals.totalAmount)} | Discount given: ${money(context.totals.discountAmount)} | Margin: ${
      context.totals.marginPercentage ?? "unknown"
    }%`,
  );
  if (context.risk) out.push(`Risk score: ${context.risk.score} (${context.risk.level})`);
  out.push(`Negotiation rounds so far: ${context.negotiationCount}`);
  out.push(`Last activity: ${context.lastActivityAt}`);

  out.push("", "LINES");
  for (const line of context.lines) {
    const ceiling = line.discountCeiling
      ? `, ceiling ${line.discountCeiling}%${line.overCeilingBy ? ` (OVER by ${line.overCeilingBy} points)` : ""}`
      : "";
    out.push(
      `- ${line.productName} [${line.sku}] x${line.quantity} @ ${line.unitPrice}, discount ${line.discountPercentage}%${ceiling}, line total ${line.lineTotal}, line margin ${line.marginPercentage ?? "unknown"}%`,
    );
  }

  if (context.approval) {
    out.push("", "APPROVAL");
    for (const request of context.approval.requests) {
      out.push(`- ${request.approverRole}: ${request.status}${request.reason ? ` (${request.reason})` : ""}`);
    }
    if (context.approval.factors.length) {
      out.push("Risk factors contributing to the score:");
      for (const factor of context.approval.factors) {
        out.push(`- ${factor.label}: ${factor.points} pts [${factor.source}]`);
      }
    }
  }

  if (context.health) {
    out.push("", "DEAL HEALTH");
    out.push(`Score ${context.health.score}/100 (${context.health.severity})`);
    if (context.health.stalledDays !== null) out.push(`Stalled for ${context.health.stalledDays} days`);
    out.push(`Rule-recommended action: ${context.health.recommendedAction}`);
    for (const step of context.health.explain.steps) {
      out.push(`- ${step.label}: ${step.formula} = ${step.value}`);
    }
  }

  if (context.fulfillment) {
    out.push("", "FULFILMENT");
    if (context.fulfillment.recommendedShipments !== null) {
      out.push(
        `Recommended split: ${context.fulfillment.recommendedShipments} shipment(s), freight ${money(context.fulfillment.shippingCost)}`,
      );
    }
    if (context.fulfillment.rationale) out.push(`Allocator rationale: ${context.fulfillment.rationale}`);
    for (const allocation of context.fulfillment.allocations) {
      out.push(`- ${allocation.productName}: ${allocation.allocated}/${allocation.requested} from ${allocation.warehouseName}`);
    }
    for (const backorder of context.fulfillment.backorders) {
      out.push(`- BACKORDER ${backorder.productName} x${backorder.quantity} (${backorder.status})`);
    }
  }

  if (context.billing) {
    out.push("", "BILLING");
    out.push(`${context.billing.oneTimeLines} one-time line(s)`);
    for (const subscription of context.billing.subscriptions) {
      out.push(
        `- Recurring: ${subscription.productName} x${subscription.quantity}, ${money(subscription.amount)} per ${subscription.interval} (${subscription.status})`,
      );
    }
    for (const invoice of context.billing.invoices) {
      out.push(`- Invoice ${invoice.number} (${invoice.type}): ${money(invoice.total)} ${invoice.status}`);
    }
  }

  if (context.negotiation) {
    out.push("", `NEGOTIATION (round ${context.negotiation.round}, ${context.negotiation.status})`);
    for (const request of context.negotiation.requests) {
      out.push(
        `- Customer asked: ${request.type}${request.requestedValue ? ` ${request.requestedValue}` : ""} - ${request.reason ?? "no reason given"} [${request.status}]`,
      );
    }
    for (const comment of context.negotiation.comments) {
      out.push(`- ${comment.fromCustomer ? "Customer" : "Internal"}: "${comment.message}"`);
    }
  }

  if (context.upsell?.length) {
    out.push("", "UPSELL SUGGESTIONS (from the upsell engine)");
    for (const suggestion of context.upsell) {
      out.push(
        `- ${suggestion.productName}: ${suggestion.reason}${suggestion.additionalRevenue ? ` (+${money(suggestion.additionalRevenue)})` : ""}`,
      );
    }
  }

  return out.join("\n");
}

/**
 * The caller's whole book of work, for questions that are not about one deal.
 *
 * Deliberately shallow: the pipeline screen asks "which of these needs me
 * today", and answering that does not require every line of every quotation.
 */
export async function buildPipelineContext(user: AuthzUser): Promise<string> {
  const rows = await listQuotations(user);
  if (rows.length === 0) throw new AiError("no_context", "No deals are visible to this user");

  const out: string[] = [
    `PIPELINE for ${user.role ?? user.kind} - ${rows.length} deal(s) visible to this user`,
    "",
  ];

  for (const row of rows.slice(0, 40)) {
    out.push(
      `- ${row.quoteNumber} | ${row.customerName} | ${row.stage} | total ${row.totalAmount} | margin ${row.marginPercentage}% | risk ${row.riskScore} (${row.riskLevel}) | owner ${row.salesRepName} | last activity ${row.lastActivityAt.toISOString()}`,
    );
  }
  if (rows.length > 40) out.push(`...and ${rows.length - 40} more not listed.`);

  return out.join("\n");
}
