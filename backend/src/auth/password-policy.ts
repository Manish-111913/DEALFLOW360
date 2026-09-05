import { z } from "zod";

/**
 * The corporate password policy, in one place.
 *
 * The sign-up and reset screens both print this policy to the user as a
 * checklist. Those three lines and this file have to agree, or the screen is
 * telling the user a rule the server does not enforce - so the rules are named
 * here and the screen renders `PASSWORD_RULES` rather than its own prose.
 */

export const PASSWORD_MIN_LENGTH = 12;

export interface PasswordRule {
  /** Shown to the user, and the wording the API echoes back on failure. */
  readonly label: string;
  readonly test: (value: string) => boolean;
}

export const PASSWORD_RULES: readonly PasswordRule[] = [
  {
    label: `Minimum ${PASSWORD_MIN_LENGTH} characters in length`,
    test: (v) => v.length >= PASSWORD_MIN_LENGTH,
  },
  {
    label: "Both uppercase and lowercase characters",
    test: (v) => /[a-z]/.test(v) && /[A-Z]/.test(v),
  },
  {
    label: "At least one number & approved special symbol",
    test: (v) => /[0-9]/.test(v) && /[^A-Za-z0-9]/.test(v),
  },
];

/** Which rules a candidate password fails, in the order shown on screen. */
export function failedPasswordRules(value: string): PasswordRule[] {
  return PASSWORD_RULES.filter((rule) => !rule.test(value));
}

/**
 * The Zod schema every password field uses - signup, reset, and any future
 * change-password flow.
 *
 * Reports every broken rule at once rather than the first, because a user
 * fixing one requirement per round trip is the thing that makes people pick
 * weaker passwords.
 */
export const passwordSchema = z.string().superRefine((value, ctx) => {
  for (const rule of failedPasswordRules(value)) {
    ctx.addIssue({ code: "custom", message: rule.label });
  }
});

/**
 * A coarse strength signal for the meter on the sign-up screen.
 *
 * Deliberately the same thresholds the screen used when it was a mockup, so
 * the meter behaves the way it was drawn - it is an encouragement, not the
 * gate. `passwordSchema` is the gate.
 */
export type PasswordStrength = "empty" | "weak" | "medium" | "strong";

export function passwordStrength(value: string): PasswordStrength {
  if (!value) return "empty";
  if (value.length < 8) return "weak";
  if (value.length < PASSWORD_MIN_LENGTH) return "medium";
  return failedPasswordRules(value).length === 0 ? "strong" : "medium";
}
