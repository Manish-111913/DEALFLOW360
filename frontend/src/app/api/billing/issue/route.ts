import { NextResponse } from "next/server";
import { issueBillingAs, runBillingAs } from "@dealflow/backend";
import { getCurrentUser } from "@/auth";
import { badRequest, handleServiceError, requireUser } from "@/lib/http";

/**
 * Raise what a confirmed order owes, or run the recurring cycle.
 *
 * Two actions on one route because they are the same decision from the screen -
 * "bill this" - and differ only in scope: one order, or every subscription
 * period that has come due. `quotationId` present means the first.
 *
 * Neither was reachable from the product before. Every invoice in the database
 * had been written by the demo seed, which meant Record Payment could only ever
 * act on rows a script had created.
 */
export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    requireUser(user);

    let payload: unknown = {};
    try {
      payload = await request.json();
    } catch {
      // An empty body is the "run the cycle" case, so this is not an error.
    }

    const { quotationId } = (payload as { quotationId?: unknown }) ?? {};

    if (quotationId === undefined) {
      return NextResponse.json(await runBillingAs(user));
    }
    if (typeof quotationId !== "string" || !quotationId) {
      return badRequest("quotationId must be a quotation id");
    }

    return NextResponse.json(await issueBillingAs(user, quotationId));
  } catch (error) {
    return handleServiceError(error);
  }
}
