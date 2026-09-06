import { NextResponse } from "next/server";
import { listProducts, listQuotableCustomers } from "@dealflow/backend";
import { getCurrentUser } from "@/auth";
import { handleServiceError, requireUser } from "@/lib/http";

/**
 * What the New Quotation dialog and the line picker need, in one call.
 *
 * The customer list is scoped: a rep is offered their own accounts and
 * unassigned ones, never another rep's book. Both halves are needed together
 * to open the dialog, so they are fetched together rather than making the
 * screen wait on two round trips.
 */
export async function GET() {
  try {
    const user = await getCurrentUser();
    requireUser(user);

    const [customers, products] = await Promise.all([
      listQuotableCustomers(user),
      listProducts({ activeOnly: true }),
    ]);

    return NextResponse.json({
      customers,
      products: products.map((product) => ({
        id: product.id,
        sku: product.sku,
        name: product.name,
        type: product.type,
        basePrice: product.basePrice.toFixed(2),
      })),
    });
  } catch (error) {
    return handleServiceError(error);
  }
}
