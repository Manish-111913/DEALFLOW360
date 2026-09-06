import { NextResponse } from "next/server";
import { submitForApprovalAs } from "@dealflow/backend";
import { getCurrentUser } from "@/auth";
import { handleServiceError, requireUser } from "@/lib/http";

/**
 * Declare a quotation finished.
 *
 * The rep is not requesting approval - routing decides whether anyone has to
 * look at it, from the risk score and the ceiling breaches (B3). The response
 * says which way it went, so the screen can tell the rep whether they are
 * waiting on someone or already clear to send.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const user = await getCurrentUser();
    requireUser(user);

    return NextResponse.json(await submitForApprovalAs(user, id));
  } catch (error) {
    return handleServiceError(error);
  }
}
