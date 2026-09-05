import { NextResponse } from "next/server";
import { confirmPortalQuotation } from "@dealflow/backend";
import { getCurrentUser } from "@/auth";
import { portalError } from "@/lib/portal-response";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const result = await confirmPortalQuotation({
    user: await getCurrentUser(),
    quotationId: id,
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
