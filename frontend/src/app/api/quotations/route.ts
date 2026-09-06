import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createQuotationAs,
  getPipelineSummary,
  listQuotations,
  type PipelineStage,
} from "@dealflow/backend";
import { getCurrentUser } from "@/auth";
import { badRequest, handleServiceError, requireUser } from "@/lib/http";

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

const createSchema = z.object({
  customerId: z.string().min(1),
  /** Honoured only for a manager or admin; a rep always owns what they create. */
  salesRepId: z.string().min(1).nullable().optional(),
  validUntil: z.string().min(1).nullable().optional(),
});

/**
 * Start a new quotation.
 *
 * It begins empty and in DRAFT - lines are added through
 * /api/quotations/:id/lines, and each addition re-runs the pricing, margin and
 * risk chain. `createQuotationAs` decides who may own it.
 */
export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    requireUser(user);

    const parsed = createSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return badRequest("A customerId is required");

    const quotation = await createQuotationAs(user, parsed.data);
    return NextResponse.json(
      {
        id: quotation.id,
        quoteNumber: quotation.quoteNumber,
        status: quotation.status,
      },
      { status: 201 },
    );
  } catch (error) {
    return handleServiceError(error);
  }
}
