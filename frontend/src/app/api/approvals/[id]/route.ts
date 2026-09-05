import { NextResponse } from "next/server";
import { assertQuotationVisible, getApprovalOverview } from "@dealflow/backend";
import { getCurrentUser } from "@/auth";
import { handleServiceError, notFound, requireUser } from "@/lib/http";

/** The exception, its risk factors and the approval chain for one quotation. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const user = await getCurrentUser();
    requireUser(user);
    await assertQuotationVisible(user, id);

    const overview = await getApprovalOverview(user, id);
    if (!overview) return notFound();
    return NextResponse.json(overview);
  } catch (error) {
    return handleServiceError(error);
  }
}
