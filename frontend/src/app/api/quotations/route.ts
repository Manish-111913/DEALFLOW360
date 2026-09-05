import { NextResponse } from "next/server";
import { getPipelineSummary, listQuotations, type PipelineStage } from "@dealflow/backend";
import { getCurrentUser } from "@/auth";
import { handleServiceError, requireUser } from "@/lib/http";

const STAGES: PipelineStage[] = [
  "DRAFT",
  "PENDING_APPROVAL",
  "NEGOTIATION",
  "APPROVED",
  "FULFILLMENT",
  "CLOSED",
];

/**
 * The scoped quotation list, plus the pipeline totals for the same rows.
 *
 * Both come from `listQuotations`, so the column headers can never disagree
 * with the cards underneath them.
 */
export async function GET(request: Request) {
  try {
    const user = await getCurrentUser();
    requireUser(user);

    const params = new URL(request.url).searchParams;
    const stageParam = params.get("stage");
    const stage = STAGES.find((s) => s === stageParam);

    const [rows, pipeline] = await Promise.all([
      listQuotations(user, {
        stage,
        mineOnly: params.get("mine") === "true",
        search: params.get("q") ?? undefined,
      }),
      getPipelineSummary(user),
    ]);

    return NextResponse.json({ rows, pipeline });
  } catch (error) {
    return handleServiceError(error);
  }
}
