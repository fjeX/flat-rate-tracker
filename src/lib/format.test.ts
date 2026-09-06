// Guards the two rules that got this file written (escalation
// unpaid-record-row-rounding, 2026-08-13): a nonzero value never prints as a
// bare zero, and a document's rows add up to the total printed under them.
import { describe, expect, it } from "vitest";
import { fmtHours, fmtHours2, fmtHoursGrouped, fmtMoney2 } from "./format";

describe("fmtHours", () => {
  it("renders whole and rounded hours to one decimal", () => {
    expect(fmtHours(8)).toBe("8.0");
    expect(fmtHours(8.05)).toBe("8.1");
    expect(fmtHours(8.04)).toBe("8.0");
  });

  it("renders a true zero as 0.0", () => {
    expect(fmtHours(0)).toBe("0.0");
  });

  // The bug. actual_hours is numeric(5,2), so a tapped-and-saved timer lands on
  // 0.01 — real work, on a real line, printing as if nothing had happened.
  it("never prints a bare zero for a nonzero value", () => {
    expect(fmtHours(0.01)).toBe("<0.1");
    expect(fmtHours(0.04)).toBe("<0.1");
    expect(fmtHours(0.044)).toBe("<0.1");
  });

  it("floors everything genuinely nearer 0.0 than 0.1", () => {
    // Reverted 2026-09-06, second pass. The first shortfall-one-decimal-float
    // fix snapped to 2dp before rounding, which pulled 0.045–0.049 up onto 0.05
    // and printed "0.1". The justification was that hours are numeric(5,2) so
    // 0.049 "cannot be a real value" — but most numbers reaching fmtHours are
    // NOT the stored column. They are quotients (requiredPerDay, chart
    // averages), where 0.049 is a perfectly real value nearer to 0.0 than to
    // 0.1. Rounding is now done once, on the value given.
    expect(fmtHours(0.049)).toBe("<0.1");
    expect(fmtHours(0.045)).toBe("<0.1");
  });

  it("keeps the sign on a negative that rounds away", () => {
    // DiscrepancyCard prints variances, which go negative. "0.0h" for a -0.02
    // variance loses both the magnitude and the direction.
    expect(fmtHours(-0.02)).toBe("-<0.1");
  });

  it("still rounds normally either side of the floor", () => {
    expect(fmtHours(0.05)).toBe("0.1");
    expect(fmtHours(-0.06)).toBe("-0.1");
  });

  it("puts -0.05 exactly where it puts 0.05", () => {
    // This used to floor to "-<0.1" while 0.05 printed "0.1", because
    // Math.round(-0.5) is -0, not -1 — the negative boundary landed one step
    // lower than the positive one. On DiscrepancyCard, where variances go both
    // ways, that made a five-hundredths shortfall look smaller than a
    // five-hundredths overpayment. fmtHours now rounds half AWAY from zero, so
    // the two boundaries are mirror images.
    expect(fmtHours(-0.05)).toBe("-0.1");
    expect(fmtHours(0.05)).toBe("0.1");
  });
});

describe("fmtHours2", () => {
  it("renders at the resolution hours are stored at", () => {
    expect(fmtHours2(2.75)).toBe("2.75");
    expect(fmtHours2(0.01)).toBe("0.01");
    expect(fmtHours2(8)).toBe("8.00");
  });

  it("never prints a negative zero", () => {
    expect(fmtHours2(-0)).toBe("0.00");
  });

  // The property that matters on a claim document: a service manager adding up
  // the column lands on the printed total. At 1dp this failed — eleven rows
  // displaying 2.8h under a total displaying 2.7h.
  it("makes displayed rows sum to the displayed total", () => {
    const rows = [0.25, 0.25, 0.25, 0.25, 0.3, 0.3, 0.3, 0.3, 0.2, 0.05, 0.35];
    const total = rows.reduce((s, h) => s + h, 0);

    const summedFromDisplay = rows
      .map((h) => Number(fmtHours2(h)))
      .reduce((s, h) => s + h, 0);

    expect(fmtHours2(summedFromDisplay)).toBe(fmtHours2(total));
  });

  it("would NOT have reconciled at one decimal — the regression this replaces", () => {
    const rows = [0.24, 0.24, 0.24, 0.24, 0.24];
    const total = rows.reduce((s, h) => s + h, 0); // 1.2
    const summedFrom1dp = rows
      .map((h) => Number(fmtHours(h)))
      .reduce((s, h) => s + h, 0); // 0.2 × 5 = 1.0

    expect(fmtHours(summedFrom1dp)).not.toBe(fmtHours(total));
    // …and the 2dp rendering of the same rows does reconcile.
    const summedFrom2dp = rows
      .map((h) => Number(fmtHours2(h)))
      .reduce((s, h) => s + h, 0);
    expect(fmtHours2(summedFrom2dp)).toBe(fmtHours2(total));
  });
});

// Escalation shortfall-one-decimal-float (2026-09-06). Every number these
// formatters see is an unrounded reduce over floats, so the value that reaches
// them is not the value the database holds. Snapping to the stored resolution
// (2dp) before rounding for display is the whole fix — and it must NOT disturb
// values that were already rounding correctly.
describe("float dust below a rounding boundary", () => {
  it("rounds the real reproducer up, not down", () => {
    // The bot's shortfall figure: 82.1 flagged - 70.25 paid. In binary that is
    // 11.849999999999994, which rounds to 11.8 at one decimal even though the
    // stored data says 11.85 → 11.9.
    const dusty = 82.1 - 70.25;
    expect(dusty).not.toBe(11.85); // the dust is real, not a test artefact
    expect(fmtHours(dusty)).toBe("11.9");
    expect(fmtHours2(dusty)).toBe("11.85");
  });

  it("leaves already-correct round-half-up cases alone", () => {
    // Both of these were cited as manifestations of the bug and neither is one:
    // they are exact halves at the stored resolution and already rounded up.
    expect(fmtHours(330.75)).toBe("330.8");
    expect(fmtHours(305.25)).toBe("305.3");
    // And a value genuinely below the boundary still rounds down.
    expect(fmtHours(11.84)).toBe("11.8");
  });

  it("does not resurrect the sub-resolution floor bypass", () => {
    // Snapping must not turn a real-but-tiny value into a printed zero.
    expect(fmtHours(0.004)).toBe("<0.1");
    expect(fmtHours(0)).toBe("0.0");
  });

  it("applies the same snap to money", () => {
    // Earnings are summed the same way: rate x hours, reduced unrounded.
    expect(fmtMoney2(3455.4999999999995)).toBe("$3,455.50");
  });
});

describe("fmtMoney2", () => {
  it("renders money at the resolution money is stored at", () => {
    expect(fmtMoney2(44.8)).toBe("$44.80");
    expect(fmtMoney2(0)).toBe("$0.00");
    expect(fmtMoney2(1234.5)).toBe("$1,234.50");
  });

  it("never prints a negative zero", () => {
    expect(fmtMoney2(-0)).toBe("$0.00");
    expect(fmtMoney2(-0.001)).toBe("$0.00");
  });

  // The money twin of the fmtHours2 property above, and the escalation that
  // forced it: disputepack-money-column-rounding. Four unpaid-rework rows at
  // $32/hr printed 45/42/45/35 = $167 under a total printing $166.
  it("makes displayed rows sum to the displayed total", () => {
    const rows = [1.4, 1.3, 1.4, 1.1].map((h) => h * 32);
    const total = rows.reduce((s, d) => s + d, 0);

    const summedFromDisplay = rows
      .map((d) => Number(fmtMoney2(d).replace(/[$,]/g, "")))
      .reduce((s, d) => s + d, 0);

    expect(fmtMoney2(summedFromDisplay)).toBe(fmtMoney2(total));
    expect(fmtMoney2(total)).toBe("$166.40");
  });

  it("would NOT have reconciled at whole dollars — the regression this replaces", () => {
    const rows = [1.4, 1.3, 1.4, 1.1].map((h) => h * 32);
    const total = rows.reduce((s, d) => s + d, 0);
    const whole = (n: number) =>
      n.toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      });
    const summedFromWhole = rows
      .map((d) => Number(whole(d).replace(/[$,]/g, "")))
      .reduce((s, d) => s + d, 0);

    expect(whole(summedFromWhole)).toBe("$167");
    expect(whole(total)).toBe("$166");
    expect(whole(summedFromWhole)).not.toBe(whole(total));
  });
});

describe("fmtHoursGrouped", () => {
  it("groups thousands, which is the only reason it exists", () => {
    expect(fmtHoursGrouped(1234.5)).toBe("1,234.5");
    expect(fmtHoursGrouped(12345.67)).toBe("12,345.7");
    expect(fmtHoursGrouped(-1234.5)).toBe("-1,234.5");
  });

  it("leaves anything under four digits exactly as fmtHours renders it", () => {
    for (const n of [0, 2, 8.05, 41.15, 999.94, -0.06]) {
      expect(fmtHoursGrouped(n)).toBe(fmtHours(n));
    }
  });

  // The divergence this closes. A private `toLocaleString` with
  // maximumFractionDigits:1 agrees with fmtHours on every rounding case — it
  // has no floor, so a real 0.04h career total printed "0.0", and -0.02 printed
  // the even worse "-0.0".
  it("keeps fmtHours' sub-resolution floor instead of printing a bare zero", () => {
    expect(fmtHoursGrouped(0.04)).toBe("<0.1");
    expect(fmtHoursGrouped(0.02)).toBe("<0.1");
    expect(fmtHoursGrouped(-0.02)).toBe("-<0.1");
    // …and the string it replaces, pinned so the claim is checkable here.
    expect((0.04).toLocaleString("en-US", { maximumFractionDigits: 1, minimumFractionDigits: 1 })).toBe("0.0");
  });

  // Collected into an array rather than asserted per-iteration: 22k expect()
  // calls take longer than the default test timeout, and one array compare
  // reports every mismatch instead of only the first.
  it("agrees with fmtHours on every value in numeric(5,2) range, separators aside", () => {
    const mismatches: string[] = [];
    for (let i = -2000; i <= 20000; i++) {
      const n = i / 100;
      const grouped = fmtHoursGrouped(n).replace(/,/g, "");
      if (grouped !== fmtHours(n)) mismatches.push(`${n}: ${grouped} vs ${fmtHours(n)}`);
    }
    expect(mismatches).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Rounding behaviour — escalations shortfall-one-decimal-float and
// disputepack-money-column-rounding (2026-09-06), and the defects introduced by
// the first attempt at fixing them.
//
// The first fix snapped every value to 2dp before rounding for display. That
// works only if the value IS a stored 2dp column. Most values reaching fmtHours
// are quotients — requiredPerDay, chart averages — and the double round promoted
// everything in [x.x45, x.x50) up a full tenth. These tests pin both halves: the
// dust must go, and a genuine quotient must not move.
// ---------------------------------------------------------------------------
describe("rounding: dust vs. genuine value", () => {
  it("still fixes the original float-dust reproducer", () => {
    // 82.1 - 70.25 is 11.849999999999994 in binary, exactly 11.85 in decimal.
    expect(82.1 - 70.25).not.toBe(11.85);
    expect(fmtHours(82.1 - 70.25)).toBe("11.9");
    expect(fmtHours2(82.1 - 70.25)).toBe("11.85");
  });

  it("rounds non-2dp quotients to the TRUE nearest tenth, not a snapped one", () => {
    // 74.24 / 9 = 8.2488… — nearest tenth 8.2. Snapping to 8.25 first gave 8.3.
    expect(fmtHours(74.24 / 9)).toBe("8.2");
    expect(fmtHours(37.449)).toBe("37.4");
    expect(fmtHours(8.246)).toBe("8.2");
    expect(fmtHours(0.0449)).toBe("<0.1");
    // …and the values that genuinely ARE at the boundary still round up.
    expect(fmtHours(330.75)).toBe("330.8");
    expect(fmtHours(11.85)).toBe("11.9");
  });

  it("matches the true nearest tenth across a grid of quotients", () => {
    const wrong: string[] = [];
    for (let num = 1; num <= 1500; num++) {
      for (let den = 1; den <= 24; den++) {
        // Exact nearest tenth via integers: round(num*10/den), half up.
        const a = num * 10;
        const q = Math.floor(a / den);
        const want = (2 * (a - q * den) >= den ? q + 1 : q) / 10;
        const got = fmtHours(num / den);
        // The sub-resolution floor is deliberate and orthogonal: a value that
        // rounds to 0.0 prints "<0.1" instead. Everything else must land on the
        // true nearest tenth.
        const expected = want === 0 ? "<0.1" : want.toFixed(1);
        if (got !== expected) wrong.push(`${num}/${den}: ${got} vs ${expected}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("survives dust accumulated over a long sum of stored 2dp values", () => {
    // 4000 stored hours whose exact total is 20000.05 — a tenth boundary. The
    // dust in a sum this long is far larger than a fixed 1e-9 epsilon, which is
    // why the tolerance is relative.
    let f = 0;
    for (let i = 0; i < 4000; i++) f += 5.0;
    f += 0.05;
    expect(fmtHours(f)).toBe("20000.1");
    expect(fmtHours2(f)).toBe("20000.05");
  });

  it("treats a negative exactly as large as its positive twin", () => {
    expect(fmtHours(-11.85)).toBe("-11.9");
    expect(fmtHours(11.85)).toBe("11.9");
    // ±0.05 is the display-resolution boundary itself. Math.round(-0.5) is -0,
    // so a naive round called 0.05 "0.1" and -0.05 sub-resolution.
    expect(fmtHours(0.05)).toBe("0.1");
    expect(fmtHours(-0.05)).toBe("-0.1");
    // Just inside the boundary, both directions agree that it is too small.
    expect(fmtHours(0.049)).toBe("<0.1");
    expect(fmtHours(-0.049)).toBe("-<0.1");
    expect(fmtHours(0.046)).toBe("<0.1");
    expect(fmtHours(-0.046)).toBe("-<0.1");
  });

  it("never prints a negative zero", () => {
    const bad: string[] = [];
    for (const n of [0, -0, 1e-12, -1e-12, -0.0001, -0.004, -0.049, 0.049]) {
      for (const [name, s] of [
        ["fmtHours", fmtHours(n)],
        ["fmtHours2", fmtHours2(n)],
        ["fmtMoney2", fmtMoney2(n)],
        ["fmtHoursGrouped", fmtHoursGrouped(n)],
      ] as const) {
        if (/^-0(\.0+)?$/.test(s) || s === "-$0.00") bad.push(`${name}(${n}) = ${s}`);
      }
    }
    expect(bad).toEqual([]);
    expect(fmtHours(0)).toBe("0.0");
    expect(fmtHours(-0)).toBe("0.0");
    expect(fmtHours2(-1e-12)).toBe("0.00");
    expect(fmtMoney2(-1e-12)).toBe("$0.00");
  });
});
