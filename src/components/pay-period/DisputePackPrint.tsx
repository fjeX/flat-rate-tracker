"use client";

import "./dispute-pack.css";
import Link from "next/link";
import type { DisputePack } from "@/lib/dispute-pack";
import { UNPAID_TIME_KIND_LABELS } from "@/lib/types";
import { fmtHours2, fmtMoney2 } from "@/lib/format";
import { Button } from "@/components/ui/Button";
import { Table, Td, Th } from "@/components/ui/Table";
import { PpIcon } from "./PpParts";

// 2dp so printed rows reconcile with printed totals. The reconciliation itself
// happens in lib/dispute-pack and lib/unpaid-summary, which round each dollar
// row to the cent as a VALUE and sum the rounded rows — dollars are hours ×
// rate, four decimals wide, so no formatter could make the column add up on its
// own. See roundToCents in lib/format.
const fmtH = fmtHours2;

// 2dp for the same reason on the dollar column — see lib/format.
const fmtD = fmtMoney2;

// One-page printable variance report. Styles live in dispute-pack.css. On
// screen the toolbar and the wall follow the app theme and the accent, in the
// same language as the rest of the app; the SHEET is always paper (white, black
// ink) so what you preview is what prints, in every theme. Printed, the toolbar
// disappears and the page is white and readable in black and white.
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
          <Table className="dp-table">
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>RO #</Th>
                <Th>Op code</Th>
                <Th>Description</Th>
                <Th num>Performed</Th>
                <Th num>Flagged</Th>
                {priced && <Th num>Value</Th>}
              </tr>
            </thead>
            <tbody>
              {rework.map((l, i) => (
                <tr key={`${l.entryId ?? "ledger"}-${i}`}>
                  <Td>{l.date}</Td>
                  <Td className="dp-ro">{l.roNumber ? `#${l.roNumber}` : "—"}</Td>
                  <Td>{l.code ?? UNPAID_TIME_KIND_LABELS[l.kind]}</Td>
                  <Td>{l.description || "—"}</Td>
                  <Td num className="dp-variance">{fmtH(l.hours)}h</Td>
                  <Td num>{fmtH(0)}h</Td>
                  {priced && (
                    <Td num className="dp-variance">
                      {l.dollars === null ? "—" : fmtD(l.dollars)}
                    </Td>
                  )}
                </tr>
              ))}
            </tbody>
          </Table>
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
        <Link href="/pay-period" className="btn btn-line">
          <PpIcon name="chev" style={{ transform: "rotate(90deg)" }} />
          Back to pay period
        </Link>
        <Button
          variant="go"
          onClick={() => window.print()}
          disabled={nothingToPrint}
        >
          Print / Save as PDF
        </Button>
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
            <Table className="dp-table">
              <thead>
                <tr>
                  <Th>RO #</Th>
                  <Th>Date</Th>
                  <Th>Op code</Th>
                  <Th>Description</Th>
                  <Th num>Flagged</Th>
                  <Th num>Paid</Th>
                  <Th num>Variance</Th>
                  {pack.hasRates && <Th num>Amount</Th>}
                </tr>
              </thead>
              <tbody>
                {pack.lines.map((l, i) => (
                  <tr key={`${l.entryId}-${i}`}>
                    <Td className="dp-ro">#{l.roNumber}</Td>
                    <Td>{l.date}</Td>
                    <Td>{l.code}</Td>
                    <Td>{l.description || "—"}</Td>
                    <Td num>{fmtH(l.flagged)}h</Td>
                    <Td num>
                      {l.paid === null ? "—" : `${fmtH(l.paid)}h`}
                    </Td>
                    <Td num className="dp-variance">
                      {fmtH(l.deltaHours)}h
                    </Td>
                    {pack.hasRates && (
                      <Td num className="dp-variance">
                        {l.deltaDollars === null ? "—" : fmtD(l.deltaDollars)}
                      </Td>
                    )}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <Td colSpan={pack.hasRates ? 6 : 5} className="dp-total-label">
                    Total variance
                  </Td>
                  <Td num className="dp-variance">
                    {fmtH(pack.totalShortHours)}h
                  </Td>
                  {pack.hasRates && (
                    <Td num className="dp-variance">
                      {pack.totalShortDollars === null
                        ? "—"
                        : fmtD(pack.totalShortDollars)}
                    </Td>
                  )}
                </tr>
              </tfoot>
            </Table>
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

