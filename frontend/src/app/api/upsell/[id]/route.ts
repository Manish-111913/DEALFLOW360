import { NextResponse } from "next/server";
import { acceptUpsellAs, dismissUpsellAs } from "@dealflow/backend";
import { getCurrentUser } from "@/auth";
import { badRequest, handleServiceError, requireUser } from "@/lib/http";

/**
 * Take a suggestion, or say no to it.
 *
 * Both are recorded rather than one being silence: a dismissed suggestion is
 * evidence the recommender was wrong, and it is only useful if it is written
 * down. Accepting adds the line to the quotation and recomputes the deal.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const user = await getCurrentUser();
    requireUser(user);

    const body = (await request.json().catch(() => ({}))) as { decision?: unknown };
    if (body.decision !== "accept" && body.decision !== "dismiss") {
      return badRequest('decision must be "accept" or "dismiss"');
    }

    if (body.decision === "dismiss") {
      await dismissUpsellAs(user, id);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json(await acceptUpsellAs(user, id));
  } catch (error) {
    return handleServiceError(error);
  }
}
