import { NextResponse } from "next/server";
import { listQuotationVersionsAs } from "@dealflow/backend";
import { getCurrentUser } from "@/auth";
import { handleServiceError, requireUser } from "@/lib/http";

/**
 * What this quotation looked like at each point it changed.
 *
 * A version is written on every approval decision and every negotiation round,
 * and none of them could be read back - so the record existed purely to be
 * written to. This is the read that makes "what did the customer actually agree
 * to" answerable.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const user = await getCurrentUser();
    requireUser(user);
    return NextResponse.json({ versions: await listQuotationVersionsAs(user, id) });
  } catch (error) {
    return handleServiceError(error);
  }
}
