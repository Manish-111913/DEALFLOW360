import { NextResponse } from "next/server";
import { getSettings, listDecisionQueue } from "@dealflow/backend";
import { getCurrentUser } from "@/auth";
import { handleServiceError, requireUser } from "@/lib/http";

/**
 * The numbers the shared chrome shows on every screen.
 *
 * The dock's Approvals badge was the literal string "4" and the status bar said
 * "Currency: INR (₹)" in markup, so both were decoration wearing the clothes of
 * data - the badge stayed at 4 after you cleared the queue, and the currency
 * stayed rupees whatever Settings said. They are shared components, so one
 * endpoint fixes them on all nine screens rather than nine pages each passing
 * their own copy down.
 *
 * The count is `listDecisionQueue`, which is the same scoped list the Approvals
 * screen itself renders - so the badge and the page can never disagree about how
 * many things are waiting, and a rep who reviews nothing sees no badge.
 */
export async function GET() {
  try {
    const user = await getCurrentUser();
    requireUser(user);

    const settings = await getSettings();

    /**
     * The queue depth is an internal number, and only an internal number.
     *
     * A portal identity does hold `view quotation`, so `listDecisionQueue` would
     * happily count their own quotations sitting in PENDING_MANAGER and hand
     * back "2". That is a governance state the customer is deliberately never
     * shown - the portal says "awaiting seller review" precisely so it does not
     * say what the seller is doing or how far through it they are (D20). The
     * customer shell has its own dock with no badge, so there is nothing to
     * count for them anyway.
     */
    const pendingApprovals =
      user.kind === "INTERNAL" ? (await listDecisionQueue(user)).length : 0;

    return NextResponse.json({
      pendingApprovals,
      currencyCode: settings.currencyCode,
    });
  } catch (error) {
    return handleServiceError(error);
  }
}
