# DealFlow360

A standalone B2B sales-operations platform: multi-tier discount governance with automated approval routing, live upsell recommendations, multi-warehouse fulfilment splitting, hybrid one-time/recurring billing, deal-health monitoring, and a customer-facing negotiation portal.

**This is not an Odoo project.** The Odoo hackathon brief supplies the business requirements; §2 and §7 of that brief explicitly permit any stack. `DealFlow360_Documentation/07_FINAL_IMPLEMENTATION_DECISIONS.md` is the frozen decision register and outranks the other documents wherever they disagree.

## Layout

Two npm workspaces. One deployable.

```
backend/          @dealflow/backend — plain domain logic over Prisma
  prisma/         schema, migrations, seed
  src/
    clock.ts      the application clock (D3)
    db.ts         Prisma client
    audit.ts      append-only hash-chained audit log (D19)
    index.ts      the package's only public entry point
    auth/         passwords, portal magic links, registration
    authz/        roles.ts (may this role?) + scope.ts (which rows?)
    services/     domain services
  tests/          cross-cutting structural guards

frontend/         @dealflow/frontend — the Next.js app
  src/
    app/          routes; API handlers are thin delegates
    auth.ts       Auth.js configuration
    lib/          HTTP response helpers
```

The backend imports no framework — no Next.js, no React — so it stays runnable from a script, a job, or a test. A structural test enforces that boundary, and another stops the frontend reaching past `@dealflow/backend` into internal modules.

There is no build step between the packages: the backend ships TypeScript source and the frontend transpiles it.

## Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router) + TypeScript |
| Database | PostgreSQL 17 via Prisma 7 (`@prisma/adapter-pg`) |
| Auth | Auth.js v5 — password for internal users, magic link for the portal |
| UI | Tailwind 4 |
| Tests | Vitest |

Requires **Node 24 LTS**. Node 23 is a non-LTS line that Prisma 7 explicitly rejects.

## Running it

```bash
docker compose up -d      # Postgres on localhost:5433
cp .env.example .env      # set DATABASE_URL and AUTH_SECRET
npm install               # installs both workspaces
npm run db:migrate
npm run db:seed           # prints logins and a portal magic link
npm run dev
```

Port 5433 is deliberate — 5432 is usually taken by a local Postgres install. A single `.env` at the repo root serves both workspaces.

### Scripts

All run from the repo root.

| Command | Does |
|---|---|
| `npm run dev` / `build` / `start` | Next.js (frontend workspace) |
| `npm test` | Vitest (backend workspace) — see below |
| `npm run lint` | ESLint across both, including the D3 clock rule |
| `npm run typecheck` | `tsc --noEmit` in both |
| `npm run db:migrate` / `db:reset` / `db:seed` / `db:studio` / `db:generate` | Prisma |

`db:reset` is destructive; Prisma asks for explicit consent.

### Tests

`npm test` runs against a **dedicated database** (`TEST_DATABASE_URL`), which it
drops and rebuilds — migrate, then seed — before every run. Nothing it does
touches the development database, and no state carries between runs.

It needs Docker Postgres running, because the suite deliberately exercises real
constraints, real triggers and a real hash chain rather than mocking them. That
is also why the reset is DROP/CREATE rather than TRUNCATE: D19's trigger refuses
to truncate `AuditLog`, correctly, so the shortcut is unavailable.

The bootstrap refuses to run if `TEST_DATABASE_URL` resolves to the same
database as `DATABASE_URL` — it issues `DROP DATABASE`, so it must be
structurally incapable of aiming that at development data.

## Seeded accounts

All internal users share the development password `DealFlow!2026`.

| Role | Email |
|---|---|
| Admin | `admin@dealflow360.test` |
| Sales Manager | `manager@dealflow360.test` |
| Sales Rep | `priya@dealflow360.test` |
| Sales Rep | `rahul@dealflow360.test` |
| Finance / Ops | `finance@dealflow360.test` |

Customers: **Acme Industries** (Gold) and **Beta Industries** (Silver), each with a portal user. Two exist so cross-tenant isolation is genuinely testable rather than assumed. The seed prints a single-use magic link for Acme.

## Rules that are enforced, not just documented

Each is backed by a test, a lint rule, or a database constraint.

**The application clock (D3).** Nothing reads the host clock except `backend/src/clock.ts`; everything else calls `currentBusinessTime()`. An ESLint rule bans bare `new Date()` and `Date.now()` across both workspaces — `new Date(ms)` stays legal, since that is a conversion, not a clock read — and a structural test asserts the same property in case the rule is ever disabled. The offset is persisted, so demo time-travel survives a restart. This exists from the first commit because recurring billing, stalled deals and delivery slippage are otherwise impossible to demonstrate inside a five-minute demo, and it cannot be retrofitted.

**One data-scoping mechanism (D6).** `scopeFor(user, entity)` returns the Prisma `where` fragment for every scoped query. No route writes its own. Denial is an unsatisfiable filter rather than `{}`, so a caller who forgets to handle "no access" fails closed instead of returning every row.

**Two independent authorisation gates.** `can(user, action, resource)` answers *may this role at all*; `scopeFor` answers *which rows*. A rep may update quotations (the first) but only their own (the second). Approval is checked by **step type**, so Finance cannot decide a manager step regardless of seniority.

**Append-only, tamper-evident audit (D19).** Each row's hash covers its predecessor's. The database refuses `UPDATE`, `DELETE` and `TRUNCATE` via trigger, so immutability holds against a refactor or a raw `psql` prompt — not only against today's code. One consequence worth knowing: an actor with audit history **cannot be deleted**, only deactivated.

**Internal and portal identities are disjoint.** A CHECK constraint, not a convention: a user holds either a `Role` or a `customerId`, never both. Portal access is a separate surface with its own provider, not a weaker internal role.

## Status

**B-1 (Identity, Roles & Security)** and **B-2 (Customer & Product Catalog)** are complete. 119 tests passing; lint, typecheck and production build clean.

The seeded catalogue figures are load-bearing: prices and costs are chosen so the
worked examples frozen in `03_BUSINESS_RULES.md` reproduce against real data, and
tests assert each one. Changing a seed price silently breaks a demo figure.

Next: B-3 (Quotation & Margin Engine). Module specs live in
`DealFlow360_Documentation/`; prompts in `40_PROMPT_LIBRARY_BACKEND.md`.

## Known advisory: mysql2

`npm audit` reports 4 high-severity advisories in `mysql2`. They are not acted
on, deliberately:

- `mysql2` is a transitive dependency of the **Prisma CLI**, which is a
  `devDependency`. It is never a runtime dependency of the app.
- Our datasource is `postgresql`. Nothing in the codebase references MySQL, and
  `mysql2` is absent from the built server bundle (`frontend/.next/server`).
- Both advisories require an actual MySQL connection to exploit — an auth-plugin
  downgrade and a decompression bomb in the MySQL wire protocol.

`npm audit fix --force` would **downgrade Prisma to 6.x**, a breaking major
change, to patch a driver that is never loaded. An `overrides` entry does not
help either: Prisma pins `mysql2` to an exact version, so the override is a
no-op. The correct fix is upstream, in Prisma.

Re-check this when upgrading Prisma.
