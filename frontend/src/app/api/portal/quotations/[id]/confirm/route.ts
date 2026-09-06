import { NextResponse } from "next/server";
import { confirmPortalQuotation } from "@dealflow/backend";
import { getCurrentUser } from "@/auth";
import { portalError } from "@/lib/portal-response";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // The version the customer had on screen. Optional in the body because a
  // caller that omits it still gets the approval-state check; sending it adds
  // the stronger guarantee that the figures they agreed to are the figures
  // still on the quotation.
  const body = (await request.json().catch(() => null)) as { expectedVersion?: string } | null;

  const result = await confirmPortalQuotation({
    user: await getCurrentUser(),
    quotationId: id,
    expectedVersion: body?.expectedVersion ?? null,
  });

  if (result.status === 200) {
    return NextResponse.json({ orderStatus: result.orderStatus });
  }
  if (result.status === 409) {
    // Not a silent success: the terms moved while the page was open.
    return NextResponse.json({ reason: result.reason, message: result.message }, { status: 409 });
  }
  return portalError(result.status);
}
