import { describe, expect, it } from "vitest";
import { Prisma } from "../generated/prisma/client";
import { MAX_SUGGESTIONS, rankUpsells, type UpsellCandidateInput } from "./upsell";

const D = (v: string | number) => new Prisma.Decimal(v);

/** The worked example: Laptop Pro pairs with Extended Warranty. */
const WARRANTY: UpsellCandidateInput = {
  productId: "p-warranty",
  productName: "Extended Warranty",
  coPurchaseRate: "0.72",
  minMarginPercentage: "0",
  isPromoted: true,
  unitPrice: "12923.00",
  unitCost: "4523.00",
  triggeredByProductName: "Laptop Pro",
};

describe("the frozen worked example scores 0.832", () => {
  it("computes the score exactly", () => {
    const [s] = rankUpsells([WARRANTY]);
    // 0.72 x 0.6 = 0.432, plus min(1, 65/50) x 0.3 = 0.3, plus 0.1 promoted.
    expect(s.score.toFixed(4)).toBe("0.8320");
    expect(s.score.equals(D("0.832"))).toBe(true);
  });

  it("produces the documented reason string", () => {
    const [s] = rankUpsells([WARRANTY]);
    expect(s.reason).toBe("72% of similar orders include this");
  });

  // The rule reads "quantity x unitPrice x marginPercentage". Evaluated with
  // the percentage rounded to 2dp first that gives 8,399.95; evaluated exactly
  // it gives 8,400.00, which is the figure the demo quotes. Same formula, no
  // intermediate rounding.
  it("reports a margin impact of 8,400", () => {
    const [s] = rankUpsells([WARRANTY]);
    expect(s.marginImpact.equals(D("8400"))).toBe(true);
    expect(s.marginPercentage.toFixed(2)).toBe("65.00");
  });

  it("scales margin impact with the suggested quantity", () => {
    const [s] = rankUpsells([{ ...WARRANTY, suggestedQuantity: 3 }]);
    expect(s.marginImpact.equals(D("25200"))).toBe(true);
  });
});

describe("the margin floor is absolute", () => {
  // A promoted product with a bad margin is never shown, on principle.
  it("excludes a candidate below its floor however well it pairs", () => {
    const thin: UpsellCandidateInput = {
      productId: "p-thin",
      productName: "Thin Margin Add-on",
      coPurchaseRate: "0.99",
      minMarginPercentage: "40",
      isPromoted: true,
      unitPrice: "1000.00",
      unitCost: "800.00", // 20% margin, below the 40% floor
    };

    expect(rankUpsells([thin])).toEqual([]);
  });

  it("keeps a candidate sitting exactly on its floor", () => {
    const exact: UpsellCandidateInput = {
      productId: "p-exact",
      productName: "Exactly At Floor",
      coPurchaseRate: "0.50",
      minMarginPercentage: "20",
      isPromoted: false,
      unitPrice: "1000.00",
      unitCost: "800.00", // exactly 20%
    };

    expect(rankUpsells([exact])).toHaveLength(1);
  });

  it("filters before ranking, so a floor breach cannot outrank a compliant one", () => {
    const results = rankUpsells([
      {
        productId: "p-bad",
        productName: "High Pairing Low Margin",
        coPurchaseRate: "0.99",
        minMarginPercentage: "50",
        isPromoted: true,
        unitPrice: "1000.00",
        unitCost: "900.00",
      },
      WARRANTY,
    ]);

    expect(results.map((r) => r.productId)).toEqual(["p-warranty"]);
  });
});

describe("ranking", () => {
  function candidate(
    id: string,
    rate: string,
    price: string,
    cost: string,
    promoted = false,
  ): UpsellCandidateInput {
    return {
      productId: id,
      productName: id,
      coPurchaseRate: rate,
      minMarginPercentage: "0",
      isPromoted: promoted,
      unitPrice: price,
      unitCost: cost,
    };
  }

  it("never returns more than three suggestions", () => {
    const many = Array.from({ length: 9 }, (_, i) =>
      candidate(`p${i}`, `0.${9 - i}`, "1000.00", "400.00"),
    );
    expect(rankUpsells(many)).toHaveLength(MAX_SUGGESTIONS);
    expect(MAX_SUGGESTIONS).toBe(3);
  });

  it("orders by score, highest first", () => {
    const results = rankUpsells([
      candidate("low", "0.10", "1000.00", "600.00"),
      candidate("high", "0.90", "1000.00", "600.00"),
      candidate("mid", "0.50", "1000.00", "600.00"),
    ]);
    expect(results.map((r) => r.productId)).toEqual(["high", "mid", "low"]);
  });

  it("gives a promoted product the edge over an identical unpromoted one", () => {
    const results = rankUpsells([
      candidate("plain", "0.50", "1000.00", "600.00", false),
      candidate("promoted", "0.50", "1000.00", "600.00", true),
    ]);
    expect(results[0].productId).toBe("promoted");
    expect(results[0].score.minus(results[1].score).toFixed(4)).toBe("0.1000");
  });

  it("caps the margin contribution at a 50% margin", () => {
    const fifty = rankUpsells([candidate("fifty", "0", "1000.00", "500.00")])[0];
    const ninety = rankUpsells([candidate("ninety", "0", "1000.00", "100.00")])[0];

    // Both earn the full 0.3; a better margin does not keep paying.
    expect(fifty.score.toFixed(4)).toBe("0.3000");
    expect(ninety.score.toFixed(4)).toBe("0.3000");
  });

  it("is deterministic when scores tie", () => {
    const input = [
      candidate("beta", "0.50", "1000.00", "600.00"),
      candidate("alpha", "0.50", "1000.00", "600.00"),
    ];
    expect(rankUpsells(input).map((r) => r.productId)).toEqual(
      rankUpsells([...input].reverse()).map((r) => r.productId),
    );
  });
});

describe("no generic fallback", () => {
  // §7 requires suggestions to be grounded. Showing a filler product when
  // nothing pairs would break that more than showing nothing at all.
  it("returns an empty list when nothing pairs", () => {
    expect(rankUpsells([])).toEqual([]);
  });
});

describe("D22 — every suggestion explains itself", () => {
  it("shows each weighted term and the margin arithmetic", () => {
    const [s] = rankUpsells([WARRANTY]);

    expect(s.explain.value).toBe("0.8320");
    const labels = s.explain.steps.map((x) => x.label);
    expect(labels).toEqual([
      "Co-purchase weight",
      "Normalised margin",
      "Promotion boost",
      "Score",
      "Margin impact",
    ]);

    expect(s.explain.steps[0].formula).toBe("0.7200 x 0.6");
    expect(s.explain.steps[0].value).toBe("0.4320");
    expect(s.explain.steps[4].formula).toBe("1 x (12923.00 - 4523.00)");
    expect(s.explain.steps[4].value).toBe("8400.00");
    expect(s.explain.sources).toContain("D14");
  });
});
