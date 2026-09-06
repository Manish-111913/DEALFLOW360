import { NextResponse } from "next/server";
import { shareWithCustomerAs } from "@dealflow/backend";
import { getCurrentUser } from "@/auth";
import { handleServiceError, requireUser } from "@/lib/http";

/**
 * Publish a quotation to the customer portal.
 *
 * Until this happens the customer cannot see the quote at all - the portal
 * treats an unshared quotation as not found - so this is the moment a deal
 * becomes visible to the other side. It was previously only reachable by
 * running a script, which meant the demo could not be driven from the product.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const user = await getCurrentUser();
    requireUser(user);

    await shareWithCustomerAs(user, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleServiceError(error);
  }
}
