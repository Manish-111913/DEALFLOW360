import { NextResponse } from "next/server";
import { assertQuotationVisible, getBillingSchedule } from "@dealflow/backend";
import { getCurrentUser } from "@/auth";
import { handleServiceError, notFound, requireUser } from "@/lib/http";

/** One-time lines, recurring subscriptions and the invoices raised so far. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const user = await getCurrentUser();
    requireUser(user);
    await assertQuotationVisible(user, id);

    const schedule = await getBillingSchedule(user, id);
    if (!schedule) return notFound();
    return NextResponse.json(schedule);
  } catch (error) {
    return handleServiceError(error);
  }
}
