import { NextResponse } from "next/server";
import { recomputeDealHealthAs } from "@dealflow/backend";
import { getCurrentUser } from "@/auth";
import { handleServiceError, requireUser } from "@/lib/http";

/**
 * Score every live deal now.
 *
 * `recomputeAllDealHealth` describes itself as "the cron", and it is deliberately
 * just a function so a scheduler or an admin button can call it (D1). Neither
 * existed: every score on the board came from whatever the seed wrote, so a deal
 * that went stale after the seed ran stayed green for ever.
 */
export async function POST() {
  try {
    const user = await getCurrentUser();
    requireUser(user);
    return NextResponse.json(await recomputeDealHealthAs(user));
  } catch (error) {
    return handleServiceError(error);
  }
}
