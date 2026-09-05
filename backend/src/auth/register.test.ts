import { afterAll, describe, expect, it } from "vitest";
import { EmailTakenError, registerInternalUser } from "./register";
import { verifyPassword } from "./password";
import { prisma } from "../db";

const created: string[] = [];

afterAll(async () => {
  // Deactivated, not deleted. Every registration writes an audit entry, and an
  // audited actor cannot be removed (AuditLog.actorId is ON DELETE RESTRICT and
  // the table refuses UPDATE). That is the intended property, so test cleanup
  // follows the same rule the application does.
  await prisma.user.updateMany({
    where: { id: { in: created } },
    data: { active: false },
  });
  await prisma.$disconnect();
});

describe("internal signup", () => {
  it("creates an internal user with a hashed password", async () => {
    const email = `signup-${Date.parse("2026-01-01")}-${Math.random().toString(36).slice(2)}@example.test`;
    const user = await registerInternalUser({
      email,
      name: "Sign Up Test",
      password: "correct horse battery",
      role: "SALES_REP",
    });
    created.push(user.id);

    expect(user.kind).toBe("INTERNAL");
    expect(user.role).toBe("SALES_REP");
    expect(user.passwordHash).not.toBe("correct horse battery");
    expect(await verifyPassword("correct horse battery", user.passwordHash!)).toBe(true);
  });

  it("normalises the email to lower case", async () => {
    const local = `MiXeD-${Math.random().toString(36).slice(2)}`;
    const user = await registerInternalUser({
      email: `${local}@Example.TEST`,
      name: "Case Test",
      password: "password123",
      role: "FINANCE_OPS",
    });
    created.push(user.id);

    expect(user.email).toBe(`${local.toLowerCase()}@example.test`);
  });

  it("refuses a duplicate email", async () => {
    await expect(
      registerInternalUser({
        email: "priya@dealflow360.test",
        name: "Impostor",
        password: "password123",
        role: "ADMIN",
      }),
    ).rejects.toBeInstanceOf(EmailTakenError);
  });

  it("refuses a short password", async () => {
    await expect(
      registerInternalUser({
        email: `short-${Math.random().toString(36).slice(2)}@example.test`,
        name: "Short",
        password: "abc",
        role: "SALES_REP",
      }),
    ).rejects.toThrow();
  });
});

describe("audit integrity constrains user lifecycle", () => {
  it("refuses to delete a user who has audit history", async () => {
    const email = `undeletable-${Math.random().toString(36).slice(2)}@example.test`;
    const user = await registerInternalUser({
      email,
      name: "Has History",
      password: "password123",
      role: "SALES_REP",
    });
    created.push(user.id);

    // The registration above wrote an AuditLog row naming this user as actor.
    // Erasing the actor would rewrite history, so the database refuses.
    await expect(prisma.user.delete({ where: { id: user.id } })).rejects.toThrow();

    expect(await prisma.user.findUnique({ where: { id: user.id } })).not.toBeNull();
  });

  it("allows deactivation instead", async () => {
    const email = `deactivatable-${Math.random().toString(36).slice(2)}@example.test`;
    const user = await registerInternalUser({
      email,
      name: "Can Be Disabled",
      password: "password123",
      role: "SALES_REP",
    });
    created.push(user.id);

    const disabled = await prisma.user.update({
      where: { id: user.id },
      data: { active: false },
    });
    expect(disabled.active).toBe(false);
  });
});
