import { NextResponse } from "next/server";
import { assertQuotationVisible, getFulfillmentView } from "@dealflow/backend";
import { getCurrentUser } from "@/auth";
import { handleServiceError, notFound, requireUser } from "@/lib/http";

/** The recommended split, the runner-up, and what has been allocated so far. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const user = await getCurrentUser();
    requireUser(user);
    await assertQuotationVisible(user, id);

    const view = await getFulfillmentView(user, id);
    if (!view) return notFound();
    return NextResponse.json(view);
  } catch (error) {
    return handleServiceError(error);
  }
}
