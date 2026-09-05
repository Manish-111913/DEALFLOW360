import { NextResponse } from "next/server";
import { getDealHealthDashboard } from "@dealflow/backend";
import { getCurrentUser } from "@/auth";
import { handleServiceError, requireUser } from "@/lib/http";

/**
 * The Deal Health board.
 *
 * `getDealHealthDashboard` does its own capability check and row scoping - a
 * SALES_REP has no dealHealth capability and is refused outright, while a
 * manager and a finance user each see their own slice. So this route does not
 * re-implement any of that; it authenticates, delegates, and lets the thrown
 * ForbiddenError become the 403 it already describes.
 */
export async function GET() {
  try {
    const user = await getCurrentUser();
    requireUser(user);
    const rows = await getDealHealthDashboard({ user });
    return NextResponse.json({ rows });
  } catch (error) {
    return handleServiceError(error);
  }
}
