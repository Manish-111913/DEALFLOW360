import { NextResponse } from "next/server";
import { submitNegotiation } from "@dealflow/backend";
import { getCurrentUser } from "@/auth";
import { badRequest } from "@/lib/http";
import { portalError } from "@/lib/portal-response";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  let body: {
    requestType?: "COUNTER_DISCOUNT" | "QUANTITY_CHANGE" | "QUESTION" | "OTHER";
    lineId?: string;
    requestedValue?: number | string;
    reason?: string;
  };
  try {
    body = await request.json();
  } catch {
    return badRequest("Expected a JSON body");
  }
  if (!body.requestType) return badRequest("requestType is required");

  const result = await submitNegotiation({
    user: await getCurrentUser(),
    quotationId: id,
    requestType: body.requestType,
    lineId: body.lineId ?? null,
    requestedValue: body.requestedValue ?? null,
    reason: body.reason ?? null,
  });

  if (result.status === 200) {
    // The what-if is internal reasoning; the customer is told the outcome only.
    return NextResponse.json({ outcome: result.outcome, requestId: result.requestId });
  }
  if (result.status === 422) {
    return NextResponse.json({ error: result.error, field: result.field }, { status: 422 });
  }
  return portalError(result.status);
}
