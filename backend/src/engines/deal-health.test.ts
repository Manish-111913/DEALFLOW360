import { describe, expect, it } from "vitest";
import {
  computeDealHealth,
  RECOMMENDED_ACTIONS,
  severityFor,
  type DealHealthInput,
} from "./deal-health";

/** The worked example frozen in 03_BUSINESS_RULES.md. */
const STALLED_DEAL: DealHealthInput = {
  daysSinceLastActivity: 5,
  daysPendingApproval: 2,
  negotiationRounds: 1,
  delivery: "BACKORDER",
  averageDiscountOnQuote: "10.00",
  repRollingAverageDiscount: "10.00",
};

const HEALTHY_DEAL: DealHealthInput = {
  daysSinceLastActivity: 0,
  daysPendingApproval: 0,
  negotiationRounds: 0,
  delivery: "NONE",
  averageDiscountOnQuote: "8.00",
  repRollingAverageDiscount: "10.00",
};

describe("the frozen worked example scores 57", () => {
  it("computes each penalty as documented", () => {
    const r = computeDealHealth(STALLED_DEAL);

    expect(r.penalties.stalled).toBe(15); //         5 days x 3
    expect(r.penalties.approvalDelay).toBe(8); //    2 days x 4
    expect(r.penalties.negotiation).toBe(5); //      1 round x 5
    expect(r.penalties.delivery).toBe(15); //        open backorder
    expect(r.penalties.discountAnomaly).toBe(0); //  in line with the rep
    expect(r.totalPenalty).toBe(43);
  });

  it("lands on 57 and At Risk", () => {
    const r = computeDealHealth(STALLED_DEAL);

    expect(r.healthScore).toBe(57);
    expect(r.severity).toBe("AT_RISK");
  });

  // Delivery scores 15 and approval delay only 8, so the largest penalty is
  // delivery - but escalating the approval is what actually unsticks the deal.
  it("recommends escalating the approval, not chasing the larger penalty", () => {
    const r = computeDealHealth(STALLED_DEAL);

    expect(r.recommendedAction).toBe(RECOMMENDED_ACTIONS.escalate);
    expect(r.penalties.delivery).toBeGreaterThan(r.penalties.approvalDelay);
  });

  it("explains the arithmetic rather than asserting the number", () => {
    const r = computeDealHealth(STALLED_DEAL);

    expect(r.explain.value).toBe("57 / 100");
    const stalled = r.explain.steps.find((s) => s.label === "Stalled")!;
    expect(stalled.formula).toBe("5 days x 3");
    expect(stalled.value).toBe("-15");

    const recommended = r.explain.steps.find((s) => s.label === "Recommended")!;
    expect(recommended.formula).toContain("waiting on a reviewer");
  });
});

/** Acceptance: clearing the blockages should lift the deal out of At Risk. */
describe("clearing the blockages recovers the score", () => {
  it("rises into Healthy once the backorder and the approval are resolved", () => {
    const recovered = computeDealHealth({
      ...STALLED_DEAL,
      daysSinceLastActivity: 0, // acted on today
      daysPendingApproval: 0, // approval granted
      delivery: "NONE", // backorder resolved
    });

    // Only the negotiation round still counts against it.
    expect(recovered.totalPenalty).toBe(5);
    expect(recovered.healthScore).toBe(95);
    expect(recovered.severity).toBe("HEALTHY");
  });

  it("reaches at least Watch even if only the approval clears", () => {
    const partly = computeDealHealth({
      ...STALLED_DEAL,
      daysSinceLastActivity: 0,
      daysPendingApproval: 0,
    });

    expect(partly.healthScore).toBe(80);
    expect(["WATCH", "HEALTHY"]).toContain(partly.severity);
  });
});

describe("severity bands, at their exact boundaries", () => {
  it("maps each edge correctly", () => {
    expect(severityFor(100)).toBe("HEALTHY");
    expect(severityFor(80)).toBe("HEALTHY");
    expect(severityFor(79)).toBe("WATCH");
    expect(severityFor(60)).toBe("WATCH");
    expect(severityFor(59)).toBe("AT_RISK");
    expect(severityFor(35)).toBe("AT_RISK");
    expect(severityFor(34)).toBe("CRITICAL");
    expect(severityFor(0)).toBe("CRITICAL");
  });

  it("never goes below zero however bad the deal", () => {
    const awful = computeDealHealth({
      daysSinceLastActivity: 400,
      daysPendingApproval: 200,
      negotiationRounds: 50,
      delivery: "BACKORDER",
      averageDiscountOnQuote: "90.00",
      repRollingAverageDiscount: "5.00",
    });

    expect(awful.healthScore).toBe(5); // caps total 95, so 5 is the floor here
    expect(awful.severity).toBe("CRITICAL");
  });

  it("gives a pristine deal full marks", () => {
    expect(computeDealHealth(HEALTHY_DEAL).healthScore).toBe(100);
  });
});

describe("penalty caps", () => {
  it("caps stalling at 30", () => {
    expect(computeDealHealth({ ...HEALTHY_DEAL, daysSinceLastActivity: 99 }).penalties.stalled).toBe(30);
  });

  it("caps approval delay at 20", () => {
    expect(
      computeDealHealth({ ...HEALTHY_DEAL, daysPendingApproval: 99 }).penalties.approvalDelay,
    ).toBe(20);
  });

  it("caps negotiation at 15", () => {
    expect(computeDealHealth({ ...HEALTHY_DEAL, negotiationRounds: 99 }).penalties.negotiation).toBe(15);
  });

  it("scores a split lower than a backorder", () => {
    expect(computeDealHealth({ ...HEALTHY_DEAL, delivery: "SPLIT" }).penalties.delivery).toBe(5);
    expect(computeDealHealth({ ...HEALTHY_DEAL, delivery: "BACKORDER" }).penalties.delivery).toBe(15);
  });
});

/**
 * The signal that needs real history behind it: a discount is only anomalous
 * relative to how this particular rep normally sells.
 */
describe("discount anomaly is measured against the rep own habit", () => {
  it("charges one point per percentage point above their average", () => {
    const r = computeDealHealth({
      ...HEALTHY_DEAL,
      averageDiscountOnQuote: "22.00",
      repRollingAverageDiscount: "10.00",
    });

    expect(r.penalties.discountAnomaly).toBe(12);
  });

  it("charges nothing for a discount at or below their average", () => {
    expect(
      computeDealHealth({
        ...HEALTHY_DEAL,
        averageDiscountOnQuote: "10.00",
        repRollingAverageDiscount: "10.00",
      }).penalties.discountAnomaly,
    ).toBe(0);

    expect(
      computeDealHealth({
        ...HEALTHY_DEAL,
        averageDiscountOnQuote: "4.00",
        repRollingAverageDiscount: "10.00",
      }).penalties.discountAnomaly,
    ).toBe(0);
  });

  // The same 20% quote is unremarkable from a heavy discounter and alarming
  // from a rep who normally holds the line.
  it("judges the same discount differently for different reps", () => {
    const generous = computeDealHealth({
      ...HEALTHY_DEAL,
      averageDiscountOnQuote: "20.00",
      repRollingAverageDiscount: "18.00",
    });
    const disciplined = computeDealHealth({
      ...HEALTHY_DEAL,
      averageDiscountOnQuote: "20.00",
      repRollingAverageDiscount: "5.00",
    });

    expect(generous.penalties.discountAnomaly).toBe(2);
    expect(disciplined.penalties.discountAnomaly).toBe(15); // capped
  });
});

describe("recommended action", () => {
  it("nudges when inactivity is the dominant problem", () => {
    const r = computeDealHealth({
      ...HEALTHY_DEAL,
      daysSinceLastActivity: 9, // 27 points, nothing else
    });

    expect(r.severity).toBe("WATCH");
    expect(r.recommendedAction).toBe(RECOMMENDED_ACTIONS.nudge);
  });

  it("monitors when nothing dominates", () => {
    const r = computeDealHealth({
      ...HEALTHY_DEAL,
      negotiationRounds: 2, // 10
      delivery: "SPLIT", // 5
    });

    expect(r.severity).toBe("HEALTHY");
    expect(r.recommendedAction).toBe(RECOMMENDED_ACTIONS.monitor);
  });

  it("escalates whenever a struggling deal is waiting on a reviewer", () => {
    const r = computeDealHealth({
      ...HEALTHY_DEAL,
      daysSinceLastActivity: 10, // 30
      daysPendingApproval: 1, // 4
      delivery: "BACKORDER", // 15
    });

    expect(r.severity).toBe("AT_RISK");
    // Stalling is the biggest number, but a person is still the blockage.
    expect(r.penalties.stalled).toBeGreaterThan(r.penalties.approvalDelay);
    expect(r.recommendedAction).toBe(RECOMMENDED_ACTIONS.escalate);
  });

  it("does not escalate a healthy deal that merely waits a day", () => {
    const r = computeDealHealth({ ...HEALTHY_DEAL, daysPendingApproval: 1 });

    expect(r.severity).toBe("HEALTHY");
    expect(r.recommendedAction).toBe(RECOMMENDED_ACTIONS.monitor);
  });
});
