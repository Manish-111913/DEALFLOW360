import { NextResponse } from "next/server";
import { z } from "zod";
import { removeLineAs, updateLineAs } from "@dealflow/backend";
import { getCurrentUser } from "@/auth";
import { badRequest, handleServiceError, requireUser } from "@/lib/http";

const schema = z
  .object({
    quantity: z.number().int().min(1).optional(),
    discountPercentage: z.string().optional(),
    unitPrice: z.string().optional(),
  })
  .refine((edit) => Object.keys(edit).length > 0, {
    message: "Nothing to change",
  });

/** Change a line's quantity, discount or price. Recomputes the quotation. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ lineId: string }> },
) {
  try {
    const { lineId } = await params;
    const user = await getCurrentUser();
    requireUser(user);

    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return badRequest("Provide a quantity, discount or price to change");

    await updateLineAs(user, lineId, parsed.data);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleServiceError(error);
  }
}

/**
 * Take a line off the quotation.
 *
 * A removal, not a soft delete: a draft is a working document, and the audit
 * trail records what was taken off and why the totals moved.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ lineId: string }> },
) {
  try {
    const { lineId } = await params;
    const user = await getCurrentUser();
    requireUser(user);

    await removeLineAs(user, lineId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleServiceError(error);
  }
}
