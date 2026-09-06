import { NextResponse } from "next/server";
import { z } from "zod";
import { addLineAs } from "@dealflow/backend";
import { getCurrentUser } from "@/auth";
import { badRequest, handleServiceError, requireUser } from "@/lib/http";

const schema = z.object({
  productId: z.string().min(1),
  variantId: z.string().min(1).nullable().optional(),
  quantity: z.number().int().min(1),
  discountPercentage: z.string().optional(),
});

/**
 * Add a line to a draft quotation.
 *
 * `addLineAs` owns every rule this needs - who may edit, whether the quotation
 * is still a draft, and what the line costs once the catalogue has been asked.
 * Adding a line re-runs the whole recompute chain, so the response is the
 * quotation as it now stands rather than just the line.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const user = await getCurrentUser();
    requireUser(user);

    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return badRequest("A productId and a quantity of at least 1 are required");

    const line = await addLineAs(user, { quotationId: id, ...parsed.data });
    return NextResponse.json({ lineId: line.id }, { status: 201 });
  } catch (error) {
    return handleServiceError(error);
  }
}
