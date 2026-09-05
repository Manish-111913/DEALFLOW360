import type { AuthzUser } from "../authz/roles";
import {
  simulateCurrent,
  simulateQuotation,
  type ScenarioChange,
  type SimulationResult,
} from "../services/simulation";
import { cached } from "./cache";
import { buildDealContext, buildPipelineContext, renderDealContext } from "./context";
import { AiError, generateStructured, generateText } from "./gemini";
import { composePrompt, screenFraming, SYSTEM_PROMPT } from "./prompts";
import {
  DEAL_SUMMARY_SCHEMA,
  isDealSummary,
  isNextBestAction,
  isScenarioProposals,
  NEXT_BEST_ACTION_SCHEMA,
  SCENARIO_SCHEMA,
  type DealSummary,
  type NextBestAction,
  type ScenarioProposal,
} from "./schemas";

/**
 * DealIntelligenceService - every AI feature, in one place.
 *
 * The division of labour is the same in each method and is the whole design:
 *
 *   services  ->  the facts, already authorised and already computed
 *   Gemini    ->  judgement and language about those facts
 *   services  ->  anything that has to be true afterwards
 *
 * The simulator is the clearest case. The model proposes which levers to pull;
 * the margin, risk and routing engines say what happens when they are pulled.
 * No projected figure on screen was produced by a language model.
 */

// ---------------------------------------------------------------------------
// 3. Deal Assistant
// ---------------------------------------------------------------------------

export interface AssistantTurn {
  role: "user" | "assistant";
  text: string;
}

export interface AssistantRequest {
  /** Which screen the question was asked from. Changes what "this" means. */
  screen: string;
  /** The open deal, when there is one. */
  quotationId?: string | null;
  question: string;
  history?: AssistantTurn[];
}

export async function answerDealQuestion(
  user: AuthzUser,
  request: AssistantRequest,
): Promise<string> {
  const question = request.question.trim();
  if (!question) throw new AiError("no_context", "No question was asked");

  // With a deal open, the deal is the context. Without one, the caller's whole
  // pipeline is - which is what makes the same button useful on every screen.
  const context = request.quotationId
    ? renderDealContext(await buildDealContext(user, request.quotationId))
    : await buildPipelineContext(user);

  return generateText({
    system: SYSTEM_PROMPT,
    contents: composePrompt({
      framing: screenFraming(request.screen),
      context,
      history: request.history,
      task: `Answer the user's question using only the context above.

If the context does not contain what is needed, say so plainly rather than
guessing. Keep it under 180 words unless the question genuinely needs more.

Question: ${question}`,
    }),
  });
}

// ---------------------------------------------------------------------------
// 7. AI Deal Summary
// ---------------------------------------------------------------------------

export async function summariseDeal(
  user: AuthzUser,
  quotationId: string,
): Promise<{ summary: DealSummary; quoteNumber: string; customerName: string }> {
  return cached("summary", user.id, quotationId, () => generateSummary(user, quotationId));
}

async function generateSummary(
  user: AuthzUser,
  quotationId: string,
): Promise<{ summary: DealSummary; quoteNumber: string; customerName: string }> {
  const context = await buildDealContext(user, quotationId);

  const summary = await generateStructured<DealSummary>({
    system: SYSTEM_PROMPT,
    contents: composePrompt({
      context: renderDealContext(context),
      task: `Write an executive summary of this deal, one short paragraph per field.

Each section must be readable on its own. Where a section has no data in the
context - no fulfilment plan, nothing billed yet - say that, in a sentence.
Do not pad and do not repeat the same fact across sections.`,
    }),
    schema: DEAL_SUMMARY_SCHEMA as unknown as Record<string, unknown>,
    validate: isDealSummary,
  });

  return { summary, quoteNumber: context.quoteNumber, customerName: context.customerName };
}

// ---------------------------------------------------------------------------
// 4. Next Best Action
// ---------------------------------------------------------------------------

export async function nextBestAction(
  user: AuthzUser,
  quotationId: string,
): Promise<{ action: NextBestAction; quoteNumber: string; customerName: string }> {
  return cached("next-action", user.id, quotationId, () => generateNextAction(user, quotationId));
}

async function generateNextAction(
  user: AuthzUser,
  quotationId: string,
): Promise<{ action: NextBestAction; quoteNumber: string; customerName: string }> {
  const context = await buildDealContext(user, quotationId);

  const action = await generateStructured<NextBestAction>({
    system: SYSTEM_PROMPT,
    contents: composePrompt({
      context: renderDealContext(context),
      task: `Recommend the single most useful next action on this deal.

Pick the one thing that would most move it forward, not a list. Choose \`kind\`
from the enum - it drives which button the screen offers, so it must match what
you are actually recommending.

\`facts\` must quote the context. Every entry has to be something the context
states; if you cannot ground the recommendation in at least one fact, choose a
weaker action rather than inventing support for a stronger one.

For expectedImpact, give a figure only where the context supports it. Where it
does not, write "Not quantified from available data" - that is a valid and
expected answer, and preferable to a guess.

Set confidence honestly: "high" only when the context makes the case plainly.`,
    }),
    schema: NEXT_BEST_ACTION_SCHEMA as unknown as Record<string, unknown>,
    validate: isNextBestAction,
  });

  return { action, quoteNumber: context.quoteNumber, customerName: context.customerName };
}

// ---------------------------------------------------------------------------
// 5. What-if Deal Simulator
// ---------------------------------------------------------------------------

export interface ComparedScenario extends SimulationResult {
  /** Why the model proposed this one. Absent on the current-state row. */
  rationale: string | null;
}

/**
 * Propose alternatives, then compute what each actually does.
 *
 * The model never sees a projected number before proposing - it works from the
 * current deal and picks levers. Everything in the returned comparison came out
 * of the engines afterwards.
 *
 * A proposal that the simulator rejects (a line id that does not exist, a
 * product that was never suggested) is dropped rather than surfaced. The user
 * gets fewer scenarios, never a broken one.
 */
export async function proposeScenarios(
  user: AuthzUser,
  quotationId: string,
): Promise<ComparedScenario[]> {
  return cached("scenarios", user.id, quotationId, () => generateScenarios(user, quotationId));
}

async function generateScenarios(
  user: AuthzUser,
  quotationId: string,
): Promise<ComparedScenario[]> {
  const context = await buildDealContext(user, quotationId);

  // The model addresses lines and products by index, never by database id.
  // That is a containment measure and a correctness one: an index that does
  // not resolve is rejected here rather than reaching the simulator.
  const lineIndex = context.lines
    .map(
      (line, index) =>
        `  lineId "${index}" = ${line.productName} at ${line.discountPercentage}% (ceiling ${line.discountCeiling ?? "none"})`,
    )
    .join("\n");

  const upsellIndex = (context.upsell ?? [])
    .map((suggestion, index) => `  productId "${index}" = ${suggestion.productName}`)
    .join("\n");

  const proposals = await generateStructured<{ scenarios: ScenarioProposal[] }>({
    system: SYSTEM_PROMPT,
    contents: composePrompt({
      context: renderDealContext(context),
      task: `Propose two or three alternative commercial scenarios for this deal.

Address lines by these ids only:
${lineIndex}

${
  upsellIndex
    ? `Products you may add, by id:\n${upsellIndex}`
    : "No upsell products are available for this deal; do not use addProduct."
}

Rules:
- Do not state any resulting revenue, margin or risk. You are choosing levers;
  the pricing engines will compute the outcome.
- Use \`addProduct\` only with a productId from the list above.
- discountPercentage is a percent as a string, e.g. "15.00".
- Make the scenarios genuinely different from each other. A useful set covers
  protecting margin, trading value instead of discount, and holding the current
  terms and seeking approval.`,
    }),
    schema: SCENARIO_SCHEMA as unknown as Record<string, unknown>,
    validate: isScenarioProposals,
  });

  // Indices map back through this request's own context. Deliberately a local
  // closure rather than anything shared: a cache keyed outside the request
  // would leak one user's line ids into another's scenario.
  const realLineId = (index: string | undefined): string | undefined => {
    if (index === undefined) return undefined;
    const parsed = Number(index);
    if (!Number.isInteger(parsed)) return undefined;
    return context.lines[parsed]?.lineId;
  };

  const results: ComparedScenario[] = [{ ...(await simulateCurrent(user, quotationId)), rationale: null }];

  for (const proposal of proposals.scenarios) {
    const changes: ScenarioChange[] = [];
    let usable = true;

    for (const change of proposal.changes) {
      switch (change.kind) {
        case "setAllDiscounts":
          if (!change.discountPercentage) usable = false;
          else changes.push({ kind: "setAllDiscounts", discountPercentage: change.discountPercentage });
          break;
        case "setLineDiscount": {
          const lineId = realLineId(change.lineId);
          if (!lineId || !change.discountPercentage) usable = false;
          else changes.push({ kind: "setLineDiscount", lineId, discountPercentage: change.discountPercentage });
          break;
        }
        case "setQuantity": {
          const lineId = realLineId(change.lineId);
          if (!lineId || !change.quantity) usable = false;
          else changes.push({ kind: "setQuantity", lineId, quantity: change.quantity });
          break;
        }
        case "removeLine": {
          const lineId = realLineId(change.lineId);
          if (!lineId) usable = false;
          else changes.push({ kind: "removeLine", lineId });
          break;
        }
        case "addProduct": {
          // Only a product the upsell engine actually suggested for this deal.
          const suggestion =
            change.productId === undefined
              ? undefined
              : (context.upsell ?? [])[Number(change.productId)];
          if (!suggestion) usable = false;
          else
            changes.push({
              kind: "addProduct",
              productId: suggestion.productId,
              quantity: change.quantity ?? 1,
              discountPercentage: change.discountPercentage,
            });
          break;
        }
        default:
          usable = false;
      }
    }
    if (!usable || changes.length === 0) continue;

    try {
      const simulated = await simulateQuotation(user, quotationId, changes, proposal.label);
      results.push({ ...simulated, rationale: proposal.rationale });
    } catch {
      // A scenario the engines refuse is not shown. Better two honest columns
      // than three with one that could never be applied.
    }
  }

  return results;
}
