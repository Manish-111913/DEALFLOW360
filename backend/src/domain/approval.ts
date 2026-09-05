import type { ApprovalState } from "../generated/prisma/enums";

/**
 * Facts about the approval state machine, defined once.
 *
 * `scopeFor` needs to know which states Finance can see, and B-4's state
 * machine needs the same knowledge. Two literal arrays would drift the moment a
 * state is added — and a data-scoping rule that silently disagrees with the
 * workflow is a security bug, not a cosmetic one.
 *
 * This stays in code rather than becoming configuration: it describes what the
 * states *mean*, not a threshold someone would tune. The tunable part — which
 * score routes to which approver — is the `ApprovalChain` table (D11).
 */

/** Finance sees deals that have reached them, not every draft in the company. */
export const APPROVAL_STATES_VISIBLE_TO_FINANCE = [
  "PENDING_FINANCE",
  "APPROVED",
] as const satisfies readonly ApprovalState[];

/** Awaiting a human decision. Feeds the approval-delay health penalty. */
export const APPROVAL_STATES_PENDING = [
  "PENDING_MANAGER",
  "PENDING_FINANCE",
] as const satisfies readonly ApprovalState[];

/** Settled for this round; a negotiation can reopen from here. */
export const APPROVAL_STATES_SETTLED = [
  "APPROVED",
  "REJECTED",
  "RETURNED",
] as const satisfies readonly ApprovalState[];

export function isPendingApproval(state: ApprovalState): boolean {
  return (APPROVAL_STATES_PENDING as readonly ApprovalState[]).includes(state);
}
