import { NextResponse } from "next/server";
import { assertQuotationVisible, getQuotation, getUpsellSuggestions } from "@dealflow/backend";
import { getCurrentUser } from "@/auth";
import { handleServiceError, notFound, requireUser } from "@/lib/http";

/**
 * One quotation in full, with the upsell suggestions for it.
 *
 * The builder screen shows both together, so they are fetched together rather
 * than making the client wait for two round trips.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const user = await getCurrentUser();
    requireUser(user);
    await assertQuotationVisible(user, id);

    const [quotation, upsell] = await Promise.all([
      getQuotation(user, id),
      getUpsellSuggestions(id),
    ]);
    if (!quotation) return notFound();

    return NextResponse.json({ quotation, upsell });
  } catch (error) {
    return handleServiceError(error);
  }
}
