"use client";

import "./dispute-pack.css";
import Link from "next/link";
import type { DisputePack } from "@/lib/dispute-pack";
import { UNPAID_TIME_KIND_LABELS } from "@/lib/types";
import { fmtHours2 } from "@/lib/format";

// 2dp so printed rows reconcile with printed totals — see lib/format.
const fmtH = fmtHours2;

function fmtD(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

// One-page printable variance report. Styles live in dispute-pack.css so it
// prints as clean black-on-white regardless of the app theme, and the
// on-screen toolbar disappears when printed to PDF.
// The unpaid-rework section. Rendered BELOW the variance table with its own
// totals and never added into the variance total — unpaid rework is not a
// paid-vs-flagged discrepancy, it is work that flagged nothing at all. Rows with
// no rate on file print as hours only; no rate is ever assumed.
function UnpaidReworkSection({ pack }: { pack: DisputePack }) {
  const u = pack.unpaidRework;
  if (!u) return null;

  const rework = u.lines.filter(
    (l) =>
      l.kind === "comeback_own" ||
      l.kind === "comeback_other" ||
      l.kind === "rework_same_visit",
  );
  const priced = u.totalDollars !== null;

  return (
    <section className="dp-section">
      <h2>Unpaid rework performed</h2>
      <p className="dp-section-lede">
        Work performed during this pay period that flagged no hours. Listed
        separately from the variance report above and not included in its total.
      </p>

      {rework.length > 0 && (
        <>
        <p className="dp-scroll-hint" aria-hidden="true">
          Swipe the table sideways to see performed, flagged and value.
        </p>
        <div
          className="dp-table-wrap"
          tabIndex={0}
          role="region"
          aria-label="Unpaid rework performed by line"
        >
          <table className="dp-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>RO #</th>
                <th>Op code</th>
                <th>Description</th>
                <th className="dp-num">Performed</th>
                <th className="dp-num">Flagged</th>
                {priced && <th className="dp-num">Value</th>}
              </tr>
            </thead>
            <tbody>
              {rework.map((l, i) => (
                <tr key={`${l.entryId ?? "ledger"}-${i}`}>
                  <td>{l.date}</td>
                  <td>{l.roNumber ? `#${l.roNumber}` : "—"}</td>
                  <td>{l.code ?? UNPAID_TIME_KIND_LABELS[l.kind]}</td>
                  <td>{l.description || "—"}</td>
                  <td className="dp-num dp-variance">{fmtH(l.hours)}h</td>
                  <td className="dp-num">{fmtH(0)}h</td>
                  {priced && (
                    <td className="dp-num dp-variance">
                      {l.dollars === null ? "—" : fmtD(l.dollars)}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}

      <dl className="dp-section-totals">
        <div>
          <dt>Unpaid rework</dt>
          <dd>{fmtH(u.comebackHours)}h</dd>
        </div>
        {u.waitingHours > 0 && (
          <div>
            <dt>Waiting on parts or approval</dt>
            <dd>{fmtH(u.waitingHours)}h</dd>
          </div>
        )}
        {u.shopHours > 0 && (
          <div>
            <dt>Other non-productive shop time</dt>
            <dd>{fmtH(u.shopHours)}h</dd>
          </div>
        )}
        <div className="dp-section-total">
          <dt>Total unpaid time</dt>
          <dd>
            {fmtH(u.totalHours)}h
            {priced ? ` (${fmtD(u.totalDollars as number)})` : ""}
          </dd>
        </div>
      </dl>

      {priced && u.unpricedHours > 0 && (
        <p className="dp-note">
          {fmtH(u.unpricedHours)}h of the time above has no rate on file and is
          reported as hours only.
        </p>
      )}
    </section>
  );
}

export function DisputePackPrint({ pack }: { pack: DisputePack }) {
  const empty = pack.lines.length === 0;
  // A period can have no variance at all and still have unpaid rework worth
  // printing, so the print button follows BOTH sections, not just the table.
  const nothingToPrint = empty && pack.unpaidRework === null;

  return (
    <div className="dp-root">

      <div className="dp-toolbar">
        <Link href="/pay-period" className="dp-btn dp-btn-ghost">
          ← Back to pay period
        </Link>
        <button
          type="button"
          onClick={() => window.print()}
          className="dp-btn dp-btn-primary"
          disabled={nothingToPrint}
        >
          Print / Save as PDF
        </button>
      </div>

      <article className="dp-sheet">
        <header className="dp-header">
          <h1>Flagged vs. Paid Variance Report</h1>
          <dl className="dp-meta">
            {pack.techName && (
              <div>
                <dt>Technician</dt>
                <dd>{pack.techName}</dd>
              </div>
            )}
            <div>
              <dt>Pay period</dt>
              <dd>{pack.periodLabel}</dd>
            </div>
            {pack.generatedDate && (
              <div>
                <dt>Generated</dt>
                <dd>{pack.generatedDate}</dd>
              </div>
            )}
          </dl>
        </header>

        {empty ? (
          <p className="dp-empty">
            No flagged-vs-paid variances in this period.
          </p>
        ) : (
          <>
            <p className="dp-scroll-hint" aria-hidden="true">
              Swipe the table sideways to see paid, variance and amount.
            </p>
            {/* tabIndex makes the scroll region reachable without a pointer —
                a scrollable box that only a swipe can reach strands keyboard
                and switch users on the columns that carry the dollars. */}
            <div
              className="dp-table-wrap"
              tabIndex={0}
              role="region"
              aria-label="Flagged versus paid variance by line"
            >
            <table className="dp-table">
              <thead>
                <tr>
                  <th>RO #</th>
                  <th>Date</th>
                  <th>Op code</th>
                  <th>Description</th>
                  <th className="dp-num">Flagged</th>
                  <th className="dp-num">Paid</th>
                  <th className="dp-num">Variance</th>
                  {pack.hasRates && <th className="dp-num">Amount</th>}
                </tr>
              </thead>
              <tbody>
                {pack.lines.map((l, i) => (
                  <tr key={`${l.entryId}-${i}`}>
                    <td>#{l.roNumber}</td>
                    <td>{l.date}</td>
                    <td>{l.code}</td>
                    <td>{l.description || "—"}</td>
                    <td className="dp-num">{fmtH(l.flagged)}h</td>
                    <td className="dp-num">
                      {l.paid === null ? "—" : `${fmtH(l.paid)}h`}
                    </td>
                    <td className="dp-num dp-variance">
                      {fmtH(l.deltaHours)}h
                    </td>
                    {pack.hasRates && (
                      <td className="dp-num dp-variance">
                        {l.deltaDollars === null ? "—" : fmtD(l.deltaDollars)}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={pack.hasRates ? 6 : 5} className="dp-total-label">
                    Total variance
                  </td>
                  <td className="dp-num dp-variance">
                    {fmtH(pack.totalShortHours)}h
                  </td>
                  {pack.hasRates && (
                    <td className="dp-num dp-variance">
                      {pack.totalShortDollars === null
                        ? "—"
                        : fmtD(pack.totalShortDollars)}
                    </td>
                  )}
                </tr>
              </tfoot>
            </table>
            </div>

            <footer className="dp-footer">
              <p>
                All hours listed above were logged contemporaneously as the work
                was performed.
              </p>
              <p>
                Photo record available for {pack.photosAvailable} of{" "}
                {pack.disputedRoCount} listed repair order
                {pack.disputedRoCount === 1 ? "" : "s"}.
              </p>
            </footer>
          </>
        )}

        <UnpaidReworkSection pack={pack} />
      </article>
    </div>
  );
}

