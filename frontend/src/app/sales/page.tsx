import {
  assertQuotationVisible,
  getPipelineSummary,
  getQuotation,
  getUpsellSuggestions,
  listQuotations,
} from "@dealflow/backend";
import { requireInternalUser } from "@/auth";
import { SalesClient } from "./_components/sales-client";
import type { BuilderData } from "./_components/types";

/**
 * Screen 2 - the Sales Workspace.
 *
 * The board and the table are the same scoped list from `listQuotations`, so a
 * rep sees their own deals and a manager the team's, and the stage columns can
 * never disagree with the rows inside them - both are derived from one query.
 *
 * `?open=` loads one quotation into the builder, with its live upsell
 * suggestions. That is guarded, because `getQuotation` takes an id and checks
 * nothing.
 */
export default async function SalesWorkspacePage({
  searchParams,
}: {
  searchParams: Promise<{ open?: string }>;
}) {
  const user = await requireInternalUser("/sales");

  const { open } = await searchParams;

  const [rows, pipeline] = await Promise.all([
    listQuotations(user),
    getPipelineSummary(user),
  ]);

  let builder: BuilderData | null = null;

  if (open) {
    await assertQuotationVisible(user, open);
    const [quotation, upsell] = await Promise.all([
      getQuotation(user, open),
      getUpsellSuggestions(open),
    ]);

    if (quotation) {
      builder = {
        quotationId: quotation.id,
        quoteNumber: quotation.quoteNumber,
        customerName: quotation.customer.name,
        customerTier: quotation.customer.tier,
        status: quotation.status,
        approvalState: quotation.approvalState,
        subtotal: quotation.subtotal.toFixed(2),
        discountAmount: quotation.discountAmount.toFixed(2),
        taxAmount: quotation.taxAmount.toFixed(2),
        totalAmount: quotation.totalAmount.toFixed(2),
        marginPercentage: quotation.marginPercentage.toFixed(2),
        riskScore: quotation.riskScore.toFixed(2),
        lines: quotation.lines.map((line) => ({
          id: line.id,
          productName: line.product.name,
          sku: line.product.sku,
          quantity: line.quantity,
          unitPrice: line.unitPrice.toFixed(2),
          discountPercentage: Number(line.discountPercentage),
          lineTotal: line.lineTotal.toFixed(2),
          isUpsell: line.isUpsell,
        })),
        // The engine scores and explains each suggestion; the panel prints its
        // reasoning rather than inventing an attachment rate.
        upsell: upsell.map((suggestion) => ({
          productId: suggestion.productId,
          productName: suggestion.productName,
          reason: suggestion.reason,
          score: Number(suggestion.score).toFixed(3),
          marginImpact: Number(suggestion.marginImpact).toFixed(2),
          marginPercentage: Number(suggestion.marginPercentage).toFixed(2),
          isPromoted: suggestion.isPromoted,
          suggestedQuantity: suggestion.suggestedQuantity,
        })),
      };
    }
  }

  return (
    <SalesClient
      builder={builder}
      pipeline={{
        stages: pipeline.stages.map((stage) => ({
          stage: stage.stage,
          count: stage.count,
          value: stage.value,
        })),
        totalDeals: pipeline.totalDeals,
        totalValue: pipeline.totalValue,
      }}
      rows={rows.map((row) => ({
        id: row.id,
        quoteNumber: row.quoteNumber,
        customerName: row.customerName,
        salesRepName: row.salesRepName,
        stage: row.stage,
        status: row.status,
        approvalState: row.approvalState,
        totalAmount: row.totalAmount,
        marginPercentage: row.marginPercentage,
        riskScore: row.riskScore,
        riskLevel: row.riskLevel,
        lineCount: row.lineCount,
        lastActivityAt: row.lastActivityAt.toISOString(),
      }))}
    />
  );
}
