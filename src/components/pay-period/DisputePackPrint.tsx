"use client";

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

// One-page printable variance report. Self-contained styling (a scoped <style>
// block) so it prints as clean black-on-white regardless of the app theme, and
// so the on-screen toolbar disappears when printed to PDF.
export function DisputePackPrint({ pack }: { pack: DisputePack }) {
  const empty = pack.lines.length === 0;

  return (
    <div className="dp-root">
      <style>{CSS}</style>

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

const CSS = `
.dp-root {
  min-height: 100vh;
  background: #f4f4f4;
  padding: 24px 16px 64px;
  color: #111;
}
.dp-toolbar {
  max-width: 800px;
  margin: 0 auto 16px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}
.dp-btn {
  font-family: var(--font-plex), system-ui, sans-serif;
  font-size: 14px;
  font-weight: 500;
  padding: 8px 16px;
  border-radius: 8px;
  border: 1px solid #d0d0d0;
  cursor: pointer;
  text-decoration: none;
  color: #111;
  background: #fff;
}
.dp-btn-primary {
  background: #111;
  color: #fff;
  border-color: #111;
}
.dp-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.dp-sheet {
  max-width: 800px;
  margin: 0 auto;
  background: #fff;
  color: #111;
  padding: 40px;
  border-radius: 8px;
  box-shadow: 0 1px 4px rgba(0,0,0,0.12);
  font-family: var(--font-plex), system-ui, sans-serif;
  line-height: 1.5;
}
.dp-header { border-bottom: 2px solid #111; padding-bottom: 16px; margin-bottom: 24px; }
.dp-header h1 { font-size: 22px; font-weight: 700; margin: 0 0 12px; letter-spacing: -0.01em; }
.dp-meta { display: flex; flex-wrap: wrap; gap: 8px 32px; margin: 0; }
.dp-meta div { display: flex; flex-direction: column; }
.dp-meta dt { font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: #666; }
.dp-meta dd { margin: 0; font-size: 15px; font-weight: 600; }
.dp-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.dp-table th, .dp-table td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #e2e2e2; vertical-align: top; }
.dp-table thead th { font-size: 11px; text-transform: uppercase; letter-spacing: 0.03em; color: #555; border-bottom: 1.5px solid #111; }
.dp-num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.dp-variance { font-weight: 600; }
.dp-table tfoot td { border-top: 1.5px solid #111; border-bottom: none; padding-top: 12px; font-weight: 700; }
.dp-total-label { text-align: right; }
.dp-footer { margin-top: 28px; padding-top: 16px; border-top: 1px solid #e2e2e2; font-size: 12px; color: #444; }
.dp-footer p { margin: 4px 0; }
.dp-empty { font-size: 15px; color: #444; }

@media print {
  .dp-root { background: #fff; padding: 0; }
  .dp-toolbar { display: none; }
  .dp-sheet { max-width: none; margin: 0; padding: 0; border-radius: 0; box-shadow: none; }
  @page { margin: 16mm; }
}
`;
