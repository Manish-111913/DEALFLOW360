import { NextResponse } from "next/server";
import { viewPortalQuotation } from "@dealflow/backend";
import { getCurrentUser } from "@/auth";
import { portalError } from "@/lib/portal-response";

// Next 16: route params are async.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const result = await viewPortalQuotation(await getCurrentUser(), id);

  return result.status === 200
    ? NextResponse.json(result.quotation)
    : portalError(result.status);
}
