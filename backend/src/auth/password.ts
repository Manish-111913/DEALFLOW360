import bcrypt from "bcryptjs";

/**
 * Cost factor. Operational rather than business configuration, so it comes from
 * the environment rather than the settings table: a test suite wants it low for
 * speed, production wants it high, and neither is an admin decision.
 */
function cost(): number {
  const raw = Number(process.env.BCRYPT_COST);
  return Number.isInteger(raw) && raw >= 4 && raw <= 15 ? raw : 12;
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, cost());
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
