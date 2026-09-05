import { GoogleGenAI } from "@google/genai";

/**
 * The one place the Gemini SDK is constructed.
 *
 * The key is read here and nowhere else, and nothing in this module returns it.
 * Every AI feature goes through `generateText` or `generateStructured`, so
 * there is a single point where failures are classified and a single point that
 * would have to change to swap providers.
 *
 * Model note: `gemini-2.5-flash` and `gemini-2.0-flash` are refused for keys
 * issued now - the API replies "no longer available to new users" and names
 * 3.6 as the replacement. GEMINI_MODEL overrides the default for when that
 * moves again.
 *
 * Token budget note, which is easy to get wrong: 3.6 is a thinking model, its
 * reasoning tokens count against `maxOutputTokens`, and it refuses
 * `thinkingBudget: 0` outright with a 400. A trivial prompt here spent 918
 * thinking tokens against 114 of answer, so a budget sized for the answer
 * truncates the JSON mid-object and the parse fails. The defaults below leave
 * room for both, and a truncated response is reported as such rather than
 * being mistaken for a malformed one.
 */

const DEFAULT_MODEL = "gemini-3.6-flash";

/** Why an AI call did not produce an answer. Each maps to a message on screen. */
export type AiFailure =
  | "not_configured"
  | "unavailable"
  | "rate_limited"
  | "invalid_response"
  | "no_context";

export class AiError extends Error {
  readonly status = 503;
  constructor(
    readonly failure: AiFailure,
    message: string,
  ) {
    super(message);
    this.name = "AiError";
  }
}

/**
 * What the user is told for each failure (§21).
 *
 * Never a fabricated answer: if Gemini could not be reached, the screen says
 * so and the rest of DealFlow360 carries on working.
 */
export const AI_FAILURE_MESSAGE: Record<AiFailure, string> = {
  not_configured: "Deal Intelligence is not configured on this server.",
  unavailable: "Deal Intelligence is temporarily unavailable.",
  rate_limited:
    "AI requests are temporarily limited. Core DealFlow360 workflows remain available.",
  invalid_response: "Unable to generate a reliable recommendation.",
  no_context: "Not enough deal information to generate this insight.",
};

export function aiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

export function aiModel(): string {
  return process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL;
}

/**
 * The models to try, in order.
 *
 * Free-tier quota is counted per model, and the alias models draw on separate
 * buckets - with `gemini-3.6-flash` returning 429 for the day, both
 * `gemini-flash-latest` and `gemini-flash-lite-latest` still answered. Falling
 * back across them is the difference between a demo that runs and one that
 * shows a quota error, and it costs nothing when the first model is healthy.
 *
 * Override with GEMINI_FALLBACK_MODELS (comma separated) or set it empty to
 * disable fallback entirely.
 */
export function aiModels(): string[] {
  const raw = process.env.GEMINI_FALLBACK_MODELS;
  const fallbacks =
    raw === undefined
      ? ["gemini-flash-latest", "gemini-flash-lite-latest"]
      : raw.split(",").map((m) => m.trim()).filter(Boolean);

  // De-duplicated, so naming the primary among the fallbacks is harmless.
  return [...new Set([aiModel(), ...fallbacks])];
}

let client: GoogleGenAI | null = null;

function gemini(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new AiError("not_configured", "GEMINI_API_KEY is not set");
  }
  // Cached across calls, but keyed on nothing - if the key changes the process
  // restarts anyway.
  client ??= new GoogleGenAI({ apiKey });
  return client;
}

/**
 * Classify a thrown SDK error into something a screen can render.
 *
 * The SDK surfaces the upstream JSON in `message`, so the HTTP status is read
 * out of the text rather than a typed field.
 */
function classify(error: unknown): AiError {
  if (error instanceof AiError) return error;

  const message = error instanceof Error ? error.message : String(error);
  if (/\b429\b|RESOURCE_EXHAUSTED|quota/i.test(message)) {
    return new AiError("rate_limited", message);
  }
  return new AiError("unavailable", message);
}


/**
 * Which failures are worth trying again, and how long to wait first.
 *
 * `unavailable` is retried because the upstream says so in as many words -
 * "spikes in demand are usually temporary" - and a demo should ride over a
 * few seconds of model congestion rather than showing an error. `invalid_response`
 * is retried because JSON generation is sampled and a second draw genuinely
 * often succeeds.
 *
 * `rate_limited` is not retried: hammering a quota is what produced it.
 * `not_configured` and `no_context` are facts about this request, not weather.
 */
const RETRYABLE: AiFailure[] = ["unavailable", "invalid_response"];
// Two, not three. On the free tier every attempt spends one of 20 daily
// requests, so a third try costs more than the answer is likely worth.
const MAX_ATTEMPTS = 2;

function backoffMs(attempt: number): number {
  return 400 * 2 ** attempt; // 400ms before the single retry
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run `once` against each model in turn, retrying what is worth retrying.
 *
 * Two different loops, because the two failures want opposite treatment. A
 * rate limit means "not this model, not today", so the next model is tried
 * immediately and there is no point waiting. A transient outage or a malformed
 * answer means "try that again", so the same model is retried after a pause.
 */
async function withRetry<T>(once: (model: string) => Promise<T>): Promise<T> {
  let last: AiError | null = null;

  for (const model of aiModels()) {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      try {
        return await once(model);
      } catch (error) {
        const failure = classify(error);
        last = failure;

        // Move to the next model without pausing: this one has no quota left.
        if (failure.failure === "rate_limited") break;
        if (!RETRYABLE.includes(failure.failure)) throw failure;
        if (attempt < MAX_ATTEMPTS - 1) await sleep(backoffMs(attempt));
      }
    }
  }

  throw last ?? new AiError("unavailable", "Gemini did not return an answer");
}

/** Generous, because reasoning tokens are drawn from the same budget. */
const TEXT_OUTPUT_TOKENS = 4096;
const STRUCTURED_OUTPUT_TOKENS = 8192;

export interface GenerateOptions {
  /** The instruction block. Kept out of `contents` so it is never echoed. */
  system: string;
  contents: string;
  /** Lower is steadier. Business answers want steady. */
  temperature?: number;
  maxOutputTokens?: number;
}

/** Free-text generation, for the conversational assistant. */
export async function generateText(options: GenerateOptions): Promise<string> {
  return withRetry(async (model) => {
    const response = await gemini().models.generateContent({
      model,
      contents: options.contents,
      config: {
        systemInstruction: options.system,
        temperature: options.temperature ?? 0.2,
        maxOutputTokens: options.maxOutputTokens ?? TEXT_OUTPUT_TOKENS,
      },
    });

    const text = (response.text ?? "").trim();
    if (!text) throw new AiError("invalid_response", "Gemini returned no text");
    return text;
  });
}

/**
 * JSON generation against a schema (§19).
 *
 * `responseSchema` makes Gemini emit conforming JSON rather than prose that
 * happens to look like JSON, but it is not a guarantee - the parse and the
 * caller's own validation still run, and a malformed answer becomes
 * `invalid_response` rather than a half-rendered card.
 */
export async function generateStructured<T>(
  options: GenerateOptions & {
    schema: Record<string, unknown>;
    validate: (value: unknown) => value is T;
  },
): Promise<T> {
  return withRetry(async (model) => {
    const response = await gemini().models.generateContent({
      model,
      contents: options.contents,
      config: {
        systemInstruction: options.system,
        temperature: options.temperature ?? 0.2,
        maxOutputTokens: options.maxOutputTokens ?? STRUCTURED_OUTPUT_TOKENS,
        responseMimeType: "application/json",
        responseJsonSchema: options.schema,
      },
    });

    // Truncation produces JSON that stops mid-object, which would otherwise
    // read as "the model cannot follow a schema". Name it for what it is.
    if (response.candidates?.[0]?.finishReason === "MAX_TOKENS") {
      throw new AiError("invalid_response", "Gemini ran out of output budget before finishing");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse((response.text ?? "").trim());
    } catch {
      throw new AiError("invalid_response", "Gemini returned text that is not JSON");
    }

    if (!options.validate(parsed)) {
      throw new AiError("invalid_response", "Gemini returned JSON of the wrong shape");
    }
    return parsed;
  });
}
