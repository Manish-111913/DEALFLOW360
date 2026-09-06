import { NextResponse } from "next/server";
import { getHealthHistoryAs } from "@dealflow/backend";
import { getCurrentUser } from "@/auth";
import { handleServiceError, requireUser } from "@/lib/http";

/**
 * One deal's score over time.
 *
 * Snapshots are kept rather than overwritten precisely so a manager can see a
 * deal getting worse rather than only that it is bad now - and until this route
 * existed, nothing could show them that.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const user = await getCurrentUser();
    requireUser(user);
    return NextResponse.json({ history: await getHealthHistoryAs(user, id) });
  } catch (error) {
    return handleServiceError(error);
  }
}
