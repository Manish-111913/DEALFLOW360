/**
 * Public surface of @dealflow/backend.
 *
 * The frontend imports only from here. Nothing in this package imports Next.js
 * or React — it is plain domain logic over Prisma, so it stays testable without
 * a framework and reusable from a script, a job, or a test.
 */

export { prisma } from "./db";

export {
  advanceClock,
  currentBusinessTime,
  getClockOffsetMs,
  isClockLoaded,
  refreshClockOffset,
  resetClock,
  setClockOffsetMs,
} from "./clock";

export {
  appendAudit,
  auditTrailFor,
  computeAuditHash,
  GENESIS_HASH,
  verifyAuditChain,
  type AuditInput,
  type ChainVerification,
} from "./audit";

export {
  assertCan,
  can,
  ForbiddenError,
  type Action,
  type AuthzUser,
  type ConfigSubject,
  type Resource,
  type ViewSubject,
} from "./authz/roles";

export {
  isDenyAll,
  scopeFor,
  type ScopedEntity,
  type WhereFragment,
} from "./authz/scope";

export { hashPassword, verifyPassword } from "./auth/password";

export {
  consumePortalLink,
  hashToken,
  issuePortalLink,
  type ConsumeResult,
  type IssuedPortalLink,
} from "./auth/portal-tokens";

export {
  createPortalUser,
  EmailTakenError,
  internalSignupSchema,
  registerInternalUser,
  type InternalSignupInput,
} from "./auth/register";

export {
  assertCustomerCanBeQuoted,
  createCustomer,
  readCustomer,
  setCustomerTier,
  type CreateCustomerInput,
  type CustomerAccess,
} from "./services/customers";

export {
  listCatalog,
  resolveUnitPrice,
  type PriceResolution,
  type PriceSource,
  type ResolvePriceInput,
} from "./services/catalog";

export { ConflictError, NotFoundError, ValidationError } from "./errors";

export type {
  AuditAction,
  CustomerTier,
  Role,
  UserKind,
} from "./generated/prisma/enums";

export {
  computeLineMargin,
  computeOrderMargin,
  marginPercentageOf,
  type DecimalValue,
  type LineMarginResult,
  type MarginLineInput,
  type MarginResult,
  type OrderMarginResult,
} from "./engines/margin";

export { step, type ExplainStep, type Explanation } from "./engines/explain";

export {
  addQuotationLine,
  createQuotation,
  getQuotation,
  recomputeQuotation,
  removeQuotationLine,
  updateQuotationLine,
  type AddLineInput,
  type CreateQuotationInput,
  type RecomputeResult,
  type UpdateLineInput,
} from "./services/quotations";

export {
  ensureDefaultSettings,
  getSetting,
  getSettings,
  refreshSettings,
  setSetting,
  SETTING_DEFAULTS,
  SETTING_DESCRIPTIONS,
  SETTING_KEYS,
  type ResolvedSettings,
  type SettingKey,
} from "./settings";

export { ADVISORY_LOCK } from "./locks";

export {
  APPROVAL_STATES_PENDING,
  APPROVAL_STATES_SETTLED,
  APPROVAL_STATES_VISIBLE_TO_FINANCE,
  isPendingApproval,
} from "./domain/approval";

export {
  computeRisk,
  MAX_RISK_SCORE,
  RISK_BANDS,
  RISK_WEIGHTS,
  riskLevelFor,
  type DeliveryRisk,
  type RiskFactorResult,
  type RiskInput,
  type RiskLineInput,
  type RiskResult,
} from "./engines/risk";

export {
  resolveApprovalRoute,
  type ApprovalStepConfig,
  type RoutingInput,
  type RoutingResult,
} from "./engines/approval-routing";

export {
  resolveCeilings,
  resolveDiscountCeiling,
  type CeilingResolution,
  type CeilingSource,
} from "./services/discount-policy";

export {
  decideApproval,
  getApprovalOverview,
  loadActiveApprovalSteps,
  stepTypeFor,
  submitForApproval,
  type ApprovalDecision,
  type DecisionResult,
  type SubmitResult,
} from "./services/approvals";

export {
  MAX_SUGGESTIONS,
  rankUpsells,
  UPSELL_WEIGHTS,
  type UpsellCandidateInput,
  type UpsellSuggestion,
} from "./engines/upsell";

export {
  acceptUpsell,
  dismissUpsell,
  getUpsellSuggestions,
  refreshCoPurchaseRates,
  type RefreshResult,
} from "./services/upsell";

export {
  planAllocation,
  stockKey,
  type AllocationInput,
  type AllocationPlan,
  type AllocationResult,
  type DemandLine,
  type WarehouseSnapshot,
} from "./engines/allocation";

export {
  allocateFulfillment,
  consolidateBackorder,
  findConsolidatableBackorders,
  hasFulfillmentPlan,
  overrideAllocation,
  planFulfillment,
  receiveStock,
  type AllocateResult,
  type ConsolidationCandidate,
  type PlanResult,
} from "./services/fulfillment";

export {
  buildSchedule,
  cancellationCredit,
  firstCycleCharge,
  midCycleQuantityDelta,
  nextPeriod,
  periodContaining,
  remainingDaysFrom,
  type BillingPeriod,
  type ProratedAmount,
  type ScheduleEntry,
} from "./engines/billing";

export {
  cancelSubscription,
  changeSubscriptionQuantity,
  createSubscriptionsForOrder,
  getBillingSchedule,
  invoiceOneTimeLines,
  recordPayment,
  runBilling,
  type BillingRunResult,
  type BillingScheduleView,
} from "./services/billing";

export {
  evaluateWhatIf,
  type LineTerms,
  type WhatIfInput,
  type WhatIfResult,
  type WorsenedLine,
} from "./engines/negotiation";

export {
  lastApprovedSnapshot,
  snapshotQuotation,
  versionHistory,
  type ApprovedSnapshot,
  type LineSnapshot,
} from "./services/quotation-versions";

export {
  assertNoInternalFields,
  confirmPortalQuotation,
  getNegotiationHistory,
  shareWithCustomer,
  submitNegotiation,
  viewPortalQuotation,
  type ConfirmResult,
  type NegotiateResult,
  type PortalQuotation,
  type PortalStatus,
  type PortalViewResult,
} from "./services/portal";

export {
  computeDealHealth,
  HEALTH_WEIGHTS,
  RECOMMENDED_ACTIONS,
  SEVERITY_BANDS,
  severityFor,
  type DealHealthInput,
  type DealHealthResult,
  type DeliveryState,
  type HealthPenalties,
} from "./engines/deal-health";

export {
  escalateDeal,
  getDealHealthDashboard,
  getHealthHistory,
  recomputeAllDealHealth,
  repRollingAverageDiscount,
  resolveAlert,
  scoreDealHealth,
  type DashboardRow,
  type DealHealthSnapshotResult,
  type EscalationResult,
} from "./services/deal-health";
