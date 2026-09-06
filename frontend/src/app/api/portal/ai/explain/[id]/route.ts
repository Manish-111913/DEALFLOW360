import { NextResponse } from "next/server";
import { explainQuotation } from "@dealflow/backend";
import { getCurrentUser } from "@/auth";
import { handleAiError } from "@/lib/ai-http";
import { forbidden, requireUser } from "@/lib/http";

/**
 * "What am I actually looking at?" - the customer's own explainer.
 *
 * The mirror image of /api/ai/summary: that one refuses a PORTAL identity, and
 * this one refuses everybody else. Two routes rather than one widened route,
 * because the thing that must never happen here is an internal context reaching
 * a customer, and the cheapest way to guarantee that is for the customer path
 * never to touch the internal builder at all (D20).
 *
 * `explainQuotation` goes through `viewPortalQuotation`, so the customer's own
 * row scope decides which deal this can be asked about - a quotation belonging
 * to another company is not found rather than explained.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const user = await getCurrentUser();
    requireUser(user);

    // Staff have the assistant, the summary card and the whole deal context.
    // They have no business on the customer's surface, and letting them here
    // would mean two paths could answer the same question differently.
    if (user.kind !== "PORTAL") {
      return forbidden("This explainer is the customer's surface");
    }

    return NextResponse.json(await explainQuotation(user, id));
  } catch (error) {
    return handleAiError(error);
  }
}
