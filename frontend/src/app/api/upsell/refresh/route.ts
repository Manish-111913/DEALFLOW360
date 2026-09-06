import { NextResponse } from "next/server";
import { refreshUpsellRatesAs } from "@dealflow/backend";
import { getCurrentUser } from "@/auth";
import { handleServiceError, requireUser } from "@/lib/http";

/**
 * Re-derive co-purchase rates from the orders that have actually happened.
 *
 * The rates the ranking uses were computed once, by the seed, and never again -
 * so every order placed since has taught the recommender nothing. This is the
 * button that lets it learn.
 */
export async function POST() {
  try {
    const user = await getCurrentUser();
    requireUser(user);
    return NextResponse.json(await refreshUpsellRatesAs(user));
  } catch (error) {
    return handleServiceError(error);
  }
}
