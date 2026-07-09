"use client";

import "./dispute-pack.css";
import Link from "next/link";
import type { DisputePack } from "@/lib/dispute-pack";

function fmtH(n: number): string {
  return (Math.round(n * 10) / 10).toFixed(1);
}

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
export function DisputePackPrint({ pack }: { pack: DisputePack }) {
  const empty = pack.lines.length === 0;

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
          disabled={empty}
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
            <div className="dp-table-wrap">
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
      </article>
    </div>
  );
}

