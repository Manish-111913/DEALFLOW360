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
