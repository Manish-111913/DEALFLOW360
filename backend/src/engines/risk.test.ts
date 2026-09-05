import { describe, expect, it } from "vitest";
import { Prisma } from "../generated/prisma/client";
import { resolveApprovalRoute, type ApprovalStepConfig } from "./approval-routing";
import { computeRisk, MAX_RISK_SCORE, RISK_WEIGHTS, riskLevelFor } from "./risk";

const D = (v: string | number) => new Prisma.Decimal(v);

/**
 * The chain as seeded: manager from 30, finance from 60. Held here as data so
 * the routing tests exercise the configurable path rather than a constant.
 */
const CHAIN: ApprovalStepConfig[] = [
  {
    id: "step-manager",
    stepOrder: 1,
    approverRole: "SALES_MANAGER",
    minRiskScore: D(30),
    maxRiskScore: null,
    minDiscount: null,
    maxDiscount: null,
  },
  {
    id: "step-finance",
    stepOrder: 2,
    approverRole: "FINANCE_OPS",
    minRiskScore: D(60),
    maxRiskScore: null,
    minDiscount: null,
    maxDiscount: null,
  },
];

/** The worked example frozen in 03_BUSINESS_RULES.md. */
const ACME = {
  lines: [
    { label: "Laptop Pro", discountPercentage: "12.00", discountCeiling: "15.00" },
    { label: "Setup Service", discountPercentage: "18.00", discountCeiling: "10.00" },
    { label: "Onboarding Training", discountPercentage: "13.00", discountCeiling: "10.00" },
  ],
  marginPercentage: "22.00",
  targetMarginPercentage: "30.00",
  negotiationCount: 1,
  deliveryRisk: "SPLIT" as const,
};

describe("the frozen worked example scores exactly 44", () => {
  it("produces the documented contributors", () => {
    const r = computeRisk(ACME);
    const by = (s: string) => r.factors.find((f) => f.source === s)!;

    expect(by("CATEGORY_VIOLATION").points).toBe(20); // 8.0 over x 2.5
    expect(by("DEVIATION_BREADTH").points).toBe(4); //  1 further line x 4
    expect(by("MARGIN_EXPOSURE").points).toBe(10); //   8.0 gap x 1.2 = 9.6 -> 10
    expect(by("REPEATED_NEGOTIATION").points).toBe(5); // 1 round x 5
    expect(by("DELIVERY_RISK").points).toBe(5); //      split, no backorder

    expect(r.score).toBe(44);
    expect(r.level).toBe("MEDIUM");
  });

  it("identifies the worst line and the breadth separately", () => {
    const r = computeRisk(ACME);

    expect(r.worstExcess.equals(D(8))).toBe(true);
    expect(r.violatingLineCount).toBe(2);
    expect(r.anyLineOverCeiling).toBe(true);
  });

  it("routes to Sales Manager only, with no Finance step", () => {
    const r = computeRisk(ACME);
    const route = resolveApprovalRoute({
      steps: CHAIN,
      score: r.score,
      anyLineOverCeiling: r.anyLineOverCeiling,
      maxLineDiscount: r.maxLineDiscount,
    });

    expect(route.required).toBe(true);
    expect(route.steps.map((s) => s.approverRole)).toEqual(["SALES_MANAGER"]);
  });

  // 9.6 rounds to 10; without that the total would be 43.6, not the documented
  // 44. Contributors are whole numbers by design.
  it("rounds each contributor to a whole number", () => {
    const r = computeRisk(ACME);
    for (const f of r.factors) {
      expect(Number.isInteger(f.points)).toBe(true);
    }
  });
});

describe("ceiling comparison is strictly greater-than", () => {
  const line = (discount: string) => ({
    lines: [{ label: "Setup Service", discountPercentage: discount, discountCeiling: "10.00" }],
    marginPercentage: "30.00",
    targetMarginPercentage: "30.00",
    negotiationCount: 0,
  });

  const route = (discount: string) => {
    const r = computeRisk(line(discount));
    return {
      risk: r,
      route: resolveApprovalRoute({
        steps: CHAIN,
        score: r.score,
        anyLineOverCeiling: r.anyLineOverCeiling,
        maxLineDiscount: r.maxLineDiscount,
      }),
    };
  };

  it("9.99% against a 10% ceiling does not trigger approval", () => {
    const { risk, route: rt } = route("9.99");
    expect(risk.anyLineOverCeiling).toBe(false);
    expect(risk.score).toBe(0);
    expect(rt.required).toBe(false);
  });

  it("exactly 10.00% is at the ceiling, not over it", () => {
    const { risk, route: rt } = route("10.00");
    expect(risk.anyLineOverCeiling).toBe(false);
    expect(rt.required).toBe(false);
  });

  // The trigger is "any excess", not "excess above some further threshold".
  it("10.01% triggers approval even though the score is tiny", () => {
    const { risk, route: rt } = route("10.01");
    expect(risk.anyLineOverCeiling).toBe(true);
    expect(risk.score).toBeLessThan(30);
    expect(rt.required).toBe(true);
    expect(rt.steps.map((s) => s.approverRole)).toEqual(["SALES_MANAGER"]);
  });
});

/**
 * The scenario the word "blended" exists for: several lines each slightly over,
 * none alarming alone.
 */
describe("blended violations across many small deviations", () => {
  it("three lines two points over each contribute 13 points", () => {
    const r = computeRisk({
      lines: [
        { label: "A", discountPercentage: "12.00", discountCeiling: "10.00" },
        { label: "B", discountPercentage: "12.00", discountCeiling: "10.00" },
        { label: "C", discountPercentage: "12.00", discountCeiling: "10.00" },
      ],
      marginPercentage: "30.00",
      targetMarginPercentage: "30.00",
      negotiationCount: 0,
    });

    const by = (s: string) => r.factors.find((f) => f.source === s)!;
    expect(by("CATEGORY_VIOLATION").points).toBe(5); // worst excess 2 x 2.5
    expect(by("DEVIATION_BREADTH").points).toBe(8); // 2 further lines x 4
    expect(r.score).toBe(13);
  });

  it("counts breadth from the second violating line onwards", () => {
    const one = computeRisk({
      lines: [{ label: "A", discountPercentage: "12.00", discountCeiling: "10.00" }],
      marginPercentage: "30.00",
      targetMarginPercentage: "30.00",
      negotiationCount: 0,
    });
    expect(one.factors.find((f) => f.source === "DEVIATION_BREADTH")!.points).toBe(0);
  });
});

/**
 * D7 — the reason the margin cap moved from 25 to 30.
 *
 * Page 12: "It stops a rep from keeping every line technically within limits
 * while still discounting the order more than the company intends overall."
 */
describe("D7 — margin alone can require approval", () => {
  it("a compliant-looking order with a wrecked margin still routes for review", () => {
    const r = computeRisk({
      lines: [{ label: "Bundle", discountPercentage: "10.00", discountCeiling: "15.00" }],
      marginPercentage: "5.00",
      targetMarginPercentage: "30.00",
      negotiationCount: 0,
    });

    expect(r.anyLineOverCeiling).toBe(false); // every line inside its ceiling
    expect(r.factors.find((f) => f.source === "MARGIN_EXPOSURE")!.points).toBe(30);
    expect(r.score).toBe(30);
    expect(r.level).toBe("MEDIUM");

    const rt = resolveApprovalRoute({
      steps: CHAIN,
      score: r.score,
      anyLineOverCeiling: r.anyLineOverCeiling,
      maxLineDiscount: r.maxLineDiscount,
    });
    // Under the old cap of 25 this scored 25, sat below the band, and was never
    // reviewed — the exact failure D7 exists to fix.
    expect(rt.required).toBe(true);
  });

  it("caps sum to exactly 100, so the score can reach its own maximum", () => {
    expect(MAX_RISK_SCORE).toBe(100);
    expect(RISK_WEIGHTS.marginExposureCap).toBe(30);
  });
});

describe("caps hold", () => {
  it("clamps an extreme single-line violation", () => {
    const r = computeRisk({
      lines: [{ label: "A", discountPercentage: "100.00", discountCeiling: "0.00" }],
      marginPercentage: "0.00",
      targetMarginPercentage: "30.00",
      negotiationCount: 0,
    });
    expect(r.factors.find((f) => f.source === "CATEGORY_VIOLATION")!.points).toBe(30);
  });

  it("clamps runaway negotiation rounds", () => {
    const r = computeRisk({
      lines: [{ label: "A", discountPercentage: "0.00", discountCeiling: "10.00" }],
      marginPercentage: "30.00",
      targetMarginPercentage: "30.00",
      negotiationCount: 99,
    });
    expect(r.factors.find((f) => f.source === "REPEATED_NEGOTIATION")!.points).toBe(15);
  });

  it("never exceeds 100 overall", () => {
    const r = computeRisk({
      lines: Array.from({ length: 12 }, (_, i) => ({
        label: `L${i}`,
        discountPercentage: "100.00",
        discountCeiling: "0.00",
      })),
      marginPercentage: "-500.00",
      targetMarginPercentage: "30.00",
      negotiationCount: 20,
      deliveryRisk: "BACKORDER" as const,
    });
    expect(r.score).toBe(100);
    expect(r.level).toBe("HIGH");
  });
});

describe("delivery risk", () => {
  const base = {
    lines: [{ label: "A", discountPercentage: "0.00", discountCeiling: "10.00" }],
    marginPercentage: "30.00",
    targetMarginPercentage: "30.00",
    negotiationCount: 0,
  };

  it("scores 0 for a single source, 5 for a split, 10 for a backorder", () => {
    expect(computeRisk({ ...base, deliveryRisk: "NONE" }).score).toBe(0);
    expect(computeRisk({ ...base, deliveryRisk: "SPLIT" }).score).toBe(5);
    expect(computeRisk({ ...base, deliveryRisk: "BACKORDER" }).score).toBe(10);
  });

  it("defaults to no delivery risk when the pre-flight has not run", () => {
    expect(computeRisk(base).score).toBe(0);
  });
});

describe("risk bands", () => {
  it("maps score to level at the exact boundaries", () => {
    expect(riskLevelFor(0)).toBe("LOW");
    expect(riskLevelFor(29)).toBe("LOW");
    expect(riskLevelFor(30)).toBe("MEDIUM");
    expect(riskLevelFor(59)).toBe("MEDIUM");
    expect(riskLevelFor(60)).toBe("HIGH");
    expect(riskLevelFor(100)).toBe("HIGH");
  });
});

describe("escalation to finance", () => {
  const at = (score: number) =>
    resolveApprovalRoute({
      steps: CHAIN,
      score,
      anyLineOverCeiling: false,
      maxLineDiscount: D(0),
    });

  it("does not involve finance below 60", () => {
    expect(at(59).steps.map((s) => s.approverRole)).toEqual(["SALES_MANAGER"]);
  });

  it("adds finance from 60, after the manager", () => {
    expect(at(60).steps.map((s) => s.approverRole)).toEqual(["SALES_MANAGER", "FINANCE_OPS"]);
  });

  // Finance is never the first reviewer.
  it("always puts the manager first", () => {
    expect(at(95).steps[0].approverRole).toBe("SALES_MANAGER");
  });

  it("requires nothing below every band when no ceiling is breached", () => {
    expect(at(29).required).toBe(false);
    expect(at(29).steps).toEqual([]);
  });
});

describe("D22 — the score explains itself", () => {
  it("lists every contributor with its arithmetic", () => {
    const r = computeRisk(ACME);

    expect(r.explain.value).toBe("44 / 100");
    expect(r.explain.steps).toHaveLength(5);
    expect(r.explain.steps[0].formula).toBe("8.0 over x 2.5 = 20");
    expect(r.explain.steps[2].formula).toBe("8.0 gap x 1.2 = 10");
    expect(r.explain.sources).toContain("D7");
  });

  it("describes the worst line by name", () => {
    const r = computeRisk(ACME);
    const worst = r.factors.find((f) => f.source === "CATEGORY_VIOLATION")!;
    expect(worst.description).toContain("Setup Service");
    expect(worst.description).toContain("8.0 points over");
  });
});
