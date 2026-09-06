import { NextResponse } from "next/server";
import { getConfigurationOverview, resetSetting, updateSetting } from "@dealflow/backend";
import { getCurrentUser } from "@/auth";
import { badRequest, handleServiceError, requireUser } from "@/lib/http";

/**
 * The whole configuration area, and the system settings within it.
 *
 * GET is the same read the Settings screen renders from, exposed so the client
 * can refresh after a change without a full navigation. PATCH and DELETE are
 * the system-setting half - the per-subject tables have their own routes,
 * because a discount ceiling and a currency code are not the same kind of edit
 * and should not share a validator.
 */
export async function GET() {
  try {
    const user = await getCurrentUser();
    requireUser(user);
    return NextResponse.json(await getConfigurationOverview(user));
  } catch (error) {
    return handleServiceError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await getCurrentUser();
    requireUser(user);

    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return badRequest("Expected a JSON body");
    }

    const { key, value, reason } =
      (payload as { key?: unknown; value?: unknown; reason?: unknown }) ?? {};

    if (typeof key !== "string" || !key) return badRequest("key is required");
    // Values stay strings all the way down: SystemSetting stores text and each
    // key parses its own, so a number coerced here would lose "05" or "1.50".
    if (typeof value !== "string") return badRequest("value must be a string");

    return NextResponse.json(
      await updateSetting(user, {
        key,
        value,
        reason: typeof reason === "string" && reason.trim() ? reason.trim() : undefined,
      }),
    );
  } catch (error) {
    return handleServiceError(error);
  }
}

/** Put one setting back to the value it ships with. */
export async function DELETE(request: Request) {
  try {
    const user = await getCurrentUser();
    requireUser(user);

    const key = new URL(request.url).searchParams.get("key");
    if (!key) return badRequest("key is required");

    return NextResponse.json(await resetSetting(user, key));
  } catch (error) {
    return handleServiceError(error);
  }
}
