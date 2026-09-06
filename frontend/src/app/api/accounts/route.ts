import { NextResponse } from "next/server";
import { createCustomerAs } from "@dealflow/backend";
import { getCurrentUser } from "@/auth";
import { badRequest, handleServiceError, requireUser } from "@/lib/http";

/** The three tiers the ceiling tables are keyed by. */
const TIERS = ["BRONZE", "SILVER", "GOLD"] as const;
type Tier = (typeof TIERS)[number];

/**
 * Create a customer account.
 *
 * Until now the only way to add one was to re-run the seed, which is why the
 * demo has exactly the five accounts the seed writes.
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

    const { name, tier, contactName, email, phone, accountOwnerId } =
      (payload as {
        name?: unknown;
        tier?: unknown;
        contactName?: unknown;
        email?: unknown;
        phone?: unknown;
        accountOwnerId?: unknown;
      }) ?? {};

    if (typeof name !== "string" || !name.trim()) {
      return badRequest("name is required");
    }
    // Required by the route, not just by the form: a tier-less customer cannot
    // be quoted, so an account saved without one is dead on arrival.
    if (!TIERS.includes(tier as Tier)) {
      return badRequest(`tier must be one of ${TIERS.join(", ")}`);
    }

    const text = (value: unknown) => (typeof value === "string" && value.trim() ? value : null);

    const customer = await createCustomerAs(user, {
      name,
      tier: tier as Tier,
      contactName: text(contactName),
      email: text(email),
      phone: text(phone),
      accountOwnerId: text(accountOwnerId),
    });

    return NextResponse.json({ id: customer.id, name: customer.name });
  } catch (error) {
    return handleServiceError(error);
  }
}
