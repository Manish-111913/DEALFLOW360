/**
 * D22 — one explanation shape, shared by every engine.
 *
 * A computed number that cannot show its derivation is indistinguishable from a
 * hardcoded one, and §7 of the problem statement says core rules must not be
 * "hardcoded or faked for the demo". Every engine therefore returns not just a
 * value but the arithmetic that produced it, so a screen can render
 * "8.0 pts excess x 2.5 = 20" instead of "+20".
 *
 * Defined once, here, before the first engine — retrofitting a common shape
 * across eight engines later would mean touching all of them.
 */

export interface ExplainStep {
  /** What this step computes, in words. */
  label: string;
  /** The arithmetic, with real numbers substituted in. */
  formula: string;
  /** The result of this step, formatted. */
  value: string;
}

export interface Explanation {
  /** What the headline number is. */
  label: string;
  /** The headline number, formatted for display. */
  value: string;
  /** The values this derivation started from. */
  inputs: Record<string, string>;
  steps: ExplainStep[];
  /** Where the rule comes from, so a reviewer can check it against the spec. */
  sources: string[];
}

export function step(label: string, formula: string, value: string): ExplainStep {
  return { label, formula, value };
}
