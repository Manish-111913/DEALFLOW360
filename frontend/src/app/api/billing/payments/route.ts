import { NextResponse } from "next/server";
import { recordPaymentAs } from "@dealflow/backend";
import { getCurrentUser } from "@/auth";
import { badRequest, handleServiceError, requireUser } from "@/lib/http";

/** The methods the schema knows about. Anything else is a typo, not a method. */
const METHODS = ["BANK_TRANSFER", "CARD", "CASH", "CHEQUE", "OTHER"] as const;
type Method = (typeof METHODS)[number];

/**
 * Record a payment against an invoice.
 *
 * The amount stays a string the whole way down. Money is `Decimal(14,2)` in the
 * database and parsing it into a JavaScript number here - even briefly, even to
 * validate it - is how a rounding error gets into a ledger.
 */
export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    requireUser(user);

    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return badRequest("Expected a JSON body");
    }

    const { invoiceId, amount, method, reference } =
      (payload as {
        invoiceId?: unknown;
        amount?: unknown;
        method?: unknown;
        reference?: unknown;
      }) ?? {};

    if (typeof invoiceId !== "string" || !invoiceId) {
      return badRequest("invoiceId is required");
    }
    if (typeof amount !== "string" || !/^\d+(\.\d{1,2})?$/.test(amount)) {
      return badRequest("amount must be a positive figure with at most two decimal places");
    }
    if (method !== undefined && !METHODS.includes(method as Method)) {
      return badRequest(`method must be one of ${METHODS.join(", ")}`);
    }

    const result = await recordPaymentAs(user, {
      invoiceId,
      amount,
      method: method as Method | undefined,
      reference: typeof reference === "string" && reference.trim() ? reference.trim() : undefined,
    });
    return NextResponse.json(result);
  } catch (error) {
    return handleServiceError(error);
  }
}
