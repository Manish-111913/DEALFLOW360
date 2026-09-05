/**
 * The JSON shapes Gemini must return, and the guards that check it did (§19).
 *
 * Two layers on purpose. `responseJsonSchema` tells the model what to produce,
 * which it follows almost always; the guard below decides whether what actually
 * arrived can be rendered. A card built from a half-valid object is worse than
 * the honest "Unable to generate a reliable recommendation", so the guard is
 * what the code trusts.
 *
 * The guards are handwritten rather than derived from a validation library
 * because they are the security boundary for rendering: they should be readable
 * at a glance, not the output of a schema compiler.
 */

function isString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isString);
}

function has(value: unknown, key: string): boolean {
  return typeof value === "object" && value !== null && key in value;
}

// ---------------------------------------------------------------------------
// Deal summary (§7)
// ---------------------------------------------------------------------------

export interface DealSummary {
  overview: string;
  commercialPosition: string;
  risk: string;
  customerPosition: string;
  fulfillment: string;
  billing: string;
  recommendedAction: string;
}

export const DEAL_SUMMARY_SCHEMA = {
  type: "object",
  properties: {
    overview: { type: "string", description: "Who the customer is and what the opportunity is." },
    commercialPosition: { type: "string", description: "Value, discount and margin position." },
    risk: { type: "string", description: "What the risk and health figures say, and why." },
    customerPosition: { type: "string", description: "What the customer has asked for, if anything." },
    fulfillment: { type: "string", description: "How it would be delivered. Say if not planned yet." },
    billing: { type: "string", description: "One-time and recurring. Say if nothing is billed yet." },
    recommendedAction: { type: "string", description: "The single most useful next step." },
  },
  required: [
    "overview",
    "commercialPosition",
    "risk",
    "customerPosition",
    "fulfillment",
    "billing",
    "recommendedAction",
  ],
  additionalProperties: false,
} as const;

export function isDealSummary(value: unknown): value is DealSummary {
  return (
    DEAL_SUMMARY_SCHEMA.required.every((key) => has(value, key)) &&
    DEAL_SUMMARY_SCHEMA.required.every((key) => isString((value as Record<string, unknown>)[key]))
  );
}

// ---------------------------------------------------------------------------
// Next best action (§4) and explainability (§16)
// ---------------------------------------------------------------------------

/** The verbs the UI can actually act on. Anything else is advice only. */
export const ACTION_KINDS = [
  "review_discount",
  "request_approval",
  "send_revised_quotation",
  "contact_customer",
  "add_upsell",
  "remove_low_margin_item",
  "reduce_discount",
  "escalate_stalled_deal",
  "review_allocation",
  "resolve_backorder",
  "review_subscription",
  "follow_up",
  "no_action_needed",
] as const;

export type ActionKind = (typeof ACTION_KINDS)[number];

export interface NextBestAction {
  title: string;
  kind: ActionKind;
  reason: string;
  /** Statements taken from the context. Rendered under "FACT". */
  facts: string[];
  expectedImpact: {
    revenue: string;
    margin: string;
    risk: string;
    approval: string;
  };
  confidence: "low" | "medium" | "high";
}

export const NEXT_BEST_ACTION_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "The action, as an imperative sentence." },
    kind: { type: "string", enum: [...ACTION_KINDS] },
    reason: { type: "string", description: "Why this action, in business terms." },
    facts: {
      type: "array",
      items: { type: "string" },
      description: "Quoted facts from the context that justify it. Never new numbers.",
    },
    expectedImpact: {
      type: "object",
      properties: {
        revenue: { type: "string", description: "Or 'Not quantified from available data'." },
        margin: { type: "string" },
        risk: { type: "string" },
        approval: { type: "string" },
      },
      required: ["revenue", "margin", "risk", "approval"],
      additionalProperties: false,
    },
    confidence: { type: "string", enum: ["low", "medium", "high"] },
  },
  required: ["title", "kind", "reason", "facts", "expectedImpact", "confidence"],
  additionalProperties: false,
} as const;

export function isNextBestAction(value: unknown): value is NextBestAction {
  if (!has(value, "expectedImpact")) return false;
  const v = value as Record<string, unknown>;
  const impact = v.expectedImpact as Record<string, unknown>;

  return (
    isString(v.title) &&
    isString(v.kind) &&
    (ACTION_KINDS as readonly string[]).includes(v.kind) &&
    isString(v.reason) &&
    isStringArray(v.facts) &&
    typeof impact === "object" &&
    impact !== null &&
    ["revenue", "margin", "risk", "approval"].every((key) => isString(impact[key])) &&
    ["low", "medium", "high"].includes(v.confidence as string)
  );
}

// ---------------------------------------------------------------------------
// Scenario proposals (§5)
// ---------------------------------------------------------------------------

/**
 * What the model is allowed to propose.
 *
 * Note what is absent: any resulting figure. The model chooses which levers to
 * pull and names the scenario; the simulator computes what happens. That split
 * is why the comparison table can be trusted.
 */
export interface ScenarioProposal {
  label: string;
  rationale: string;
  changes: {
    kind: "setLineDiscount" | "setAllDiscounts" | "setQuantity" | "removeLine" | "addProduct";
    lineId?: string;
    productId?: string;
    quantity?: number;
    discountPercentage?: string;
  }[];
}

export interface ScenarioProposals {
  scenarios: ScenarioProposal[];
}

export const SCENARIO_SCHEMA = {
  type: "object",
  properties: {
    scenarios: {
      type: "array",
      minItems: 2,
      maxItems: 3,
      items: {
        type: "object",
        properties: {
          label: { type: "string", description: "Short name, e.g. 'Discount within ceiling'." },
          rationale: { type: "string", description: "What this scenario is trying to achieve." },
          changes: {
            type: "array",
            minItems: 1,
            items: {
              type: "object",
              properties: {
                kind: {
                  type: "string",
                  enum: ["setLineDiscount", "setAllDiscounts", "setQuantity", "removeLine", "addProduct"],
                },
                lineId: { type: "string", description: "Exact lineId from the context." },
                productId: { type: "string", description: "Exact productId from the upsell list." },
                quantity: { type: "number" },
                discountPercentage: { type: "string", description: "Percent, e.g. '15.00'." },
              },
              required: ["kind"],
              additionalProperties: false,
            },
          },
        },
        required: ["label", "rationale", "changes"],
        additionalProperties: false,
      },
    },
  },
  required: ["scenarios"],
  additionalProperties: false,
} as const;

export function isScenarioProposals(value: unknown): value is ScenarioProposals {
  if (!has(value, "scenarios")) return false;
  const scenarios = (value as { scenarios: unknown }).scenarios;
  if (!Array.isArray(scenarios) || scenarios.length === 0) return false;

  return scenarios.every((scenario) => {
    if (!isString((scenario as ScenarioProposal)?.label)) return false;
    if (!isString((scenario as ScenarioProposal)?.rationale)) return false;
    const changes = (scenario as ScenarioProposal).changes;
    return (
      Array.isArray(changes) &&
      changes.length > 0 &&
      changes.every((change) => isString(change?.kind))
    );
  });
}
