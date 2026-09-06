import { assertCan, type AuthzUser } from "../authz/roles";
import { prisma } from "../db";
import { NotFoundError, ValidationError } from "../errors";
import { submitForApproval, type SubmitResult } from "./approvals";
import { shareWithCustomer } from "./portal";
import {
  addQuotationLine,
  assertQuotationVisible,
  createQuotation,
  removeQuotationLine,
  updateQuotationLine,
} from "./quotations";

/**
 * Building a quotation, with the caller checked.
 *
 * The primitives in `quotations.ts` take no `AuthzUser` - they are the internal
 * operations that seeds, tests and other services compose, and giving them a
 * required actor would mean threading one through ninety-nine call sites that
 * have no user to offer. This module is the layer routes use instead: same
 * operations, but every one of them answers "may this person do this, to this
 * quotation" first.
 *
 * Two rules are enforced here rather than left to the caller:
 *
 *  - A quotation is always owned by someone who may own it. A rep creating a
 *    deal gets their own name on it whatever the request body said; only a
 *    manager or admin may assign it to another rep.
 *  - Nothing is authored on a quotation the caller cannot already see, and
 *    nothing is authored on one that has left DRAFT. A quote under approval or
 *    already confirmed is not a working document any more, and editing it
 *    behind the reviewer's back is exactly what the approval step is for.
 */

/** Roles that may put someone else's name on a deal. */
function mayAssignOwner(user: AuthzUser): boolean {
  return user.role === "SALES_MANAGER" || user.role === "ADMIN";
}

/**
 * Guard for every line-level edit.
 *
 * The state check is the important half. `assertCan` says a rep may update
 * quotations in general; it says nothing about whether *this* quotation is
 * still open to editing.
 */
async function assertAuthorable(user: AuthzUser, quotationId: string): Promise<void> {
  assertCan(user, "update");
  await assertQuotationVisible(user, quotationId);

  const quotation = await prisma.quotation.findUnique({
    where: { id: quotationId },
    select: { status: true, approvalState: true, quoteNumber: true },
  });
  if (!quotation) throw new NotFoundError(`Quotation ${quotationId} does not exist`);

  if (quotation.status !== "DRAFT") {
    throw new ValidationError(
      `${quotation.quoteNumber} has been sent and can no longer be edited directly.`,
      "status",
    );
  }
  if (quotation.approvalState === "PENDING_MANAGER" || quotation.approvalState === "PENDING_FINANCE") {
    throw new ValidationError(
      `${quotation.quoteNumber} is awaiting approval; it cannot be edited until that is decided.`,
      "approvalState",
    );
  }
}

export interface NewQuotation {
  customerId: string;
  /** Ignored for a rep, who always owns what they create. */
  salesRepId?: string | null;
  validUntil?: string | null;
}

export async function createQuotationAs(user: AuthzUser, input: NewQuotation) {
  assertCan(user, "create", "quotation");

  const owner = mayAssignOwner(user) && input.salesRepId ? input.salesRepId : user.id;

  // A manager assigning a deal must name a real internal rep, not any user id.
  if (owner !== user.id) {
    const rep = await prisma.user.findFirst({
      where: { id: owner, kind: "INTERNAL", active: true },
      select: { id: true },
    });
    if (!rep) throw new ValidationError("That sales rep does not exist.", "salesRepId");
  }

  return createQuotation({
    customerId: input.customerId,
    salesRepId: owner,
    actorId: user.id,
    validUntil: input.validUntil ? new Date(input.validUntil) : null,
  });
}

export interface NewLine {
  quotationId: string;
  productId: string;
  variantId?: string | null;
  quantity: number;
  discountPercentage?: string;
}

export async function addLineAs(user: AuthzUser, input: NewLine) {
  await assertAuthorable(user, input.quotationId);

  if (!Number.isInteger(input.quantity) || input.quantity < 1) {
    throw new ValidationError("Quantity must be a whole number of at least 1.", "quantity");
  }

  return addQuotationLine({
    quotationId: input.quotationId,
    productId: input.productId,
    variantId: input.variantId ?? null,
    quantity: input.quantity,
    discountPercentage: input.discountPercentage,
    actorId: user.id,
  });
}

export interface LineEdit {
  quantity?: number;
  discountPercentage?: string;
  unitPrice?: string;
}

export async function updateLineAs(user: AuthzUser, lineId: string, edit: LineEdit) {
  const line = await prisma.quotationLine.findUnique({
    where: { id: lineId },
    select: { quotationId: true },
  });
  if (!line) throw new NotFoundError(`Line ${lineId} does not exist`);

  await assertAuthorable(user, line.quotationId);

  if (edit.quantity !== undefined && (!Number.isInteger(edit.quantity) || edit.quantity < 1)) {
    throw new ValidationError("Quantity must be a whole number of at least 1.", "quantity");
  }

  return updateQuotationLine({
    lineId,
    quantity: edit.quantity,
    discountPercentage: edit.discountPercentage,
    unitPrice: edit.unitPrice,
    actorId: user.id,
  });
}

export async function removeLineAs(user: AuthzUser, lineId: string) {
  const line = await prisma.quotationLine.findUnique({
    where: { id: lineId },
    select: { quotationId: true },
  });
  if (!line) throw new NotFoundError(`Line ${lineId} does not exist`);

  await assertAuthorable(user, line.quotationId);
  return removeQuotationLine(lineId, user.id);
}

/**
 * Send a quotation for approval.
 *
 * Routing decides whether anyone actually has to look at it - the rep is not
 * asking for approval, they are declaring the quote finished (§B3).
 */
export async function submitForApprovalAs(
  user: AuthzUser,
  quotationId: string,
): Promise<SubmitResult> {
  assertCan(user, "update");
  await assertQuotationVisible(user, quotationId);
  return submitForApproval({ quotationId, actorId: user.id });
}

/**
 * Share a quotation with the customer's portal.
 *
 * Until this happens the customer cannot see the quote at all, which is why
 * `loadForPortal` treats an unshared quotation as not found. Sharing is
 * therefore a deliberate commercial act and belongs to whoever owns the deal.
 */
export async function shareWithCustomerAs(user: AuthzUser, quotationId: string): Promise<void> {
  assertCan(user, "update");
  await assertQuotationVisible(user, quotationId);

  const quotation = await prisma.quotation.findUnique({
    where: { id: quotationId },
    select: { approvalState: true, quoteNumber: true, lines: { select: { id: true } } },
  });
  if (!quotation) throw new NotFoundError(`Quotation ${quotationId} does not exist`);

  if (quotation.lines.length === 0) {
    throw new ValidationError("An empty quotation cannot be shared with a customer.", "lines");
  }

  await shareWithCustomer({ quotationId, actorId: user.id });
}
