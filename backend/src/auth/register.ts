import { z } from "zod";
import type { Role } from "../generated/prisma/enums";
import { appendAudit } from "../audit";
import { hashPassword } from "./password";
import { currentBusinessTime } from "../clock";
import { prisma } from "../db";

/**
 * Internal signup.
 *
 * §A1 and step 1 of the Quick Test Flow both say "sign up or log in", so
 * registration is a real feature, not just a seeded-account shortcut.
 */
export const internalSignupSchema = z.object({
  email: z.string().email().transform((v) => v.trim().toLowerCase()),
  name: z.string().min(1).max(120),
  password: z.string().min(8, "Password must be at least 8 characters"),
  role: z.enum(["SALES_REP", "SALES_MANAGER", "FINANCE_OPS", "ADMIN"]),
  salesTeamId: z.string().optional(),
});

export type InternalSignupInput = z.infer<typeof internalSignupSchema>;

export class EmailTakenError extends Error {
  readonly status = 409;
  constructor(email: string) {
    super(`An account already exists for ${email}`);
    this.name = "EmailTakenError";
  }
}

export async function registerInternalUser(input: InternalSignupInput) {
  const data = internalSignupSchema.parse(input);

  const existing = await prisma.user.findUnique({ where: { email: data.email } });
  if (existing) throw new EmailTakenError(data.email);

  const now = currentBusinessTime();
  const user = await prisma.user.create({
    data: {
      email: data.email,
      name: data.name,
      kind: "INTERNAL",
      role: data.role as Role,
      passwordHash: await hashPassword(data.password),
      salesTeamId: data.salesTeamId ?? null,
      createdAt: now,
      updatedAt: now,
    },
  });

  await appendAudit({
    entityName: "User",
    entityId: user.id,
    action: "CREATE",
    actorId: user.id,
    reason: "Internal signup",
    fieldChanges: { email: user.email, role: user.role },
  });

  return user;
}

/** Portal identities are created by staff, never self-registered. */
export async function createPortalUser(params: {
  email: string;
  name: string;
  customerId: string;
  actorId?: string;
}) {
  const now = currentBusinessTime();
  const user = await prisma.user.create({
    data: {
      email: params.email.trim().toLowerCase(),
      name: params.name,
      kind: "PORTAL",
      role: null,
      customerId: params.customerId,
      passwordHash: null,
      createdAt: now,
      updatedAt: now,
    },
  });

  await appendAudit({
    entityName: "User",
    entityId: user.id,
    action: "CREATE",
    actorId: params.actorId ?? null,
    reason: "Portal user provisioned",
    fieldChanges: { email: user.email, customerId: params.customerId },
  });

  return user;
}
