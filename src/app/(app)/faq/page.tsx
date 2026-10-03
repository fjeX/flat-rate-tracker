// FAQ: plain answers for techs who don't live on a computer. Every answer
// names the exact button words on screen and, where one exists, links straight
// to the place it talks about. Questions are native <details> so they open and
// close with no JavaScript and read correctly to a screen reader.
// Styles: page-info.css (.inf-*).
import type { ReactNode } from "react";
import Link from "next/link";
import { Zone } from "@/components/ui/Zone";
import { ReportBugButton } from "@/components/bug-report/ReportBugButton";
import { RequestFeatureButton } from "@/components/feature-request/RequestFeatureButton";

type Faq = {
  q: string;
  a: ReactNode;
  /** "Take me there": the page or setting the answer is about. */
  go?: { href: string; label: string };
};

type Group = { name: string; items: Faq[] };

const GROUPS: Group[] = [
  {
    name: "Getting started",
    items: [
      {
        q: "What is this app for?",
        a: (
          <>
            <p>
              It&apos;s your own record of the work you flag. The shop keeps a
              record of what you did. This is yours.
            </p>
            <p>
              Log each repair order (RO) as you finish it. The app adds up your
              hours, shows how your pay period is going, and gives you
              something to check your paycheck against. If a check comes up
              short, you&apos;ll have the ROs to show for it.
            </p>
          </>
        ),
      },
      {
        q: "What's the difference between flagged hours and clocked hours?",
        a: (
          <>
            <p>
              <b>Flagged hours</b> are the book hours on the jobs you did. That&apos;s
              what you get paid on.
            </p>
            <p>
              <b>Clocked hours</b> are the hours you were actually at the shop,
              punched in.
            </p>
            <p>
              Do a 3.0 job in 2 hours and you flagged 3.0 on 2.0 clocked. The
              app needs both numbers to work out your efficiency.
            </p>
          </>
        ),
      },
      {
        q: "Why are hours written like 1.3 instead of 1:20?",
        a: (
          <>
            <p>
              Flat rate counts time in <b>tenths of an hour</b>. That&apos;s how
              labor guides write book time and how the shop pays you, so the
              app works the same way. Type hours as a decimal: <b>1.3</b>, not
              1:20.
            </p>
            <p>One tenth (0.1) is 6 minutes:</p>
            <ul>
              <li>
                <b>0.1</b> = 6 min · <b>0.2</b> = 12 min · <b>0.3</b> = 18 min
              </li>
              <li>
                <b>0.5</b> = 30 min · <b>1.0</b> = 1 hour · <b>1.3</b> = 1 hour
                18 min
              </li>
            </ul>
            <p>
              Two exceptions. Timers save your real time more exactly than a
              tenth. And if your pay stub prints hundredths (like 74.25), type
              it exactly as printed. The paycheck check needs your stub&apos;s
              number, not a rounded one.
            </p>
          </>
        ),
      },
      {
        q: "What does efficiency mean?",
        a: (
          <>
            <p>
              Flagged hours divided by clocked hours. Flag 10 hours on an
              8-hour day and you&apos;re at 125%. Flag 6 and you&apos;re at 75%.
            </p>
            <p>
              Over 100% means you beat the book. If you haven&apos;t entered your
              clocked hours, the app can&apos;t work it out and shows a dash
              instead of a guess.
            </p>
          </>
        ),
      },
      {
        q: "Where do I enter my clocked hours?",
        a: (
          <p>
            On the <b>Dashboard</b>, in the <b>Today</b> section, there&apos;s a{" "}
            <b>Clocked</b> box. Type in how many hours you were punched in today.
            You can fix a past day from the <b>Schedule</b> page: tap the day,
            then fill in <b>Actual hours worked</b>.
          </p>
        ),
        go: { href: "/dashboard", label: "Open the Dashboard" },
      },
      {
        q: "I can't find a page. Where is everything?",
        a: (
          <>
            <p>
              <b>On a phone:</b> the bar along the bottom has Dashboard, Log RO,
              Timer, History and Op Codes. Everything else (Pay Period,
              Insights, Schedule, Settings, Account and Sign out) is in the
              menu: tap the <b>☰</b> button in the top right corner.
            </p>
            <p>
              <b>On a computer:</b> every page is listed down the left side of
              the screen.
            </p>
          </>
        ),
      },
      {
        q: "Can I put this on my phone's home screen like an app?",
        a: (
          <>
            <p>Yes. It opens like an app after that.</p>
            <ul>
              <li>
                <b>iPhone (Safari):</b> tap the Share button (the square with
                the arrow pointing up), scroll down, tap{" "}
                <b>Add to Home Screen</b>, then <b>Add</b>.
              </li>
              <li>
                <b>Android (Chrome):</b> tap the three dots in the top right,
                then <b>Add to Home screen</b> (or <b>Install app</b>).
              </li>
            </ul>
          </>
        ),
      },
    ],
  },
  {
    name: "Logging ROs",
    items: [
      {
        q: "How do I log an RO?",
        a: (
          <>
            <ol>
              <li>
                Tap <b>Log RO</b>.
              </li>
              <li>Type the RO number from your ticket.</li>
              <li>
                Search for your op codes and tap each one to add it. The book
                hours fill in for you.
              </li>
              <li>Add the vehicle and notes if you want to. They&apos;re optional.</li>
              <li>
                Tap <b>Save RO</b>. Logging a few back to back? Use{" "}
                <b>Save &amp; New</b>.
              </li>
            </ol>
            <p>
              Log it right after the job, while the ticket is in your hand.
              It&apos;s a lot harder to remember on Friday.
            </p>
          </>
        ),
        go: { href: "/log", label: "Log an RO" },
      },
      {
        q: "The Save button is grayed out. Why won't it save?",
        a: (
          <>
            <p>
              Check the RO number. A grayed-out (dashed) Save button almost
              always means one of two things:
            </p>
            <ul>
              <li>
                <b>The RO number box is empty.</b> The bar at the bottom will
                say &ldquo;Fill in RO # to save.&rdquo;
              </li>
              <li>
                <b>The RO number has a letter, dash or space in it.</b> RO
                numbers are digits only. Take out anything that isn&apos;t a
                number and the button turns back on.
              </li>
            </ul>
          </>
        ),
      },
      {
        q: "My op code isn't in the list. What do I do?",
        a: (
          <>
            <p>
              Tap the op code search on Log RO. At the bottom of the list
              there are two choices:
            </p>
            <ul>
              <li>
                <b>Create new library op code</b>: saves the code, its
                description and its book hours, so it comes up in search every
                time after this. Use this for jobs you do a lot.
              </li>
              <li>
                <b>Other op code (one-time)</b>: puts it on this RO only. Use
                this for a job you&apos;ll probably never see again.
              </li>
            </ul>
            <p>
              You can also add codes ahead of time on the <b>Op Codes</b> page
              with <b>Add a code</b>.
            </p>
          </>
        ),
        go: { href: "/op-codes", label: "Open Op Codes" },
      },
      {
        q: "My shop reused an old RO number. Is that a problem?",
        a: (
          <p>
            No. Shops recycle RO numbers all the time, and the app expects it.
            Log it like any other RO. Both jobs keep their own dates and hours.
          </p>
        ),
      },
      {
        q: "I made a mistake on an RO. How do I fix it or delete it?",
        a: (
          <ol>
            <li>
              Go to <b>History</b> and find the RO. You can search by RO number.
            </li>
            <li>Tap the RO number to open it.</li>
            <li>
              Tap <b>Edit RO</b> to change it, or <b>Delete</b> (bottom left) to
              remove it.
            </li>
          </ol>
        ),
        go: { href: "/history", label: "Open History" },
      },
      {
        q: "Is there a faster way to log an RO?",
        a: (
          <p>
            Yes, <b>Quick Add</b>. Turn it on in Settings under{" "}
            <b>Quick Add RO</b>, and a <b>Quick Add RO</b> button shows up on
            your Dashboard. It&apos;s a short form: RO number and op codes,
            then save.
          </p>
        ),
        go: { href: "/settings?section=quick-add", label: "Turn on Quick Add" },
      },
      {
        q: "Can I take a picture of the RO instead of typing it?",
        a: (
          <>
            <p>
              Yes. On the Log RO page, tap <b>Scan RO</b> and take a photo of
              the ticket. It fills in the RO number, vehicle and op codes it
              can read.
            </p>
            <p>
              Before the first scan, set it up once in Settings under{" "}
              <b>RO Scan Templates</b>: upload a photo of one of your shop&apos;s
              tickets and show the app where each piece of information sits.
              Always check what it filled in before you save.
            </p>
          </>
        ),
        go: { href: "/settings?section=templates", label: "Set up scanning" },
      },
      {
        q: "The job is going to take a few days. How do I log that?",
        a: (
          <p>
            Open it as a ticket. On Log RO, turn on{" "}
            <b>Open ticket — no op codes yet</b> before anything else. All you
            need is the RO number. The hours you put in each day get logged as
            you go, and when the job is done you add the op codes and close
            the ticket. The flag lands on the day you close it.
          </p>
        ),
      },
      {
        q: "How do I log a comeback?",
        a: (
          <p>
            Log the RO like normal, add the op code, then tap{" "}
            <b>Mark as comeback</b> on that line. It flags 0 hours, because you
            don&apos;t get paid for a comeback, but the time you put into it is
            still recorded as unpaid rework. That way you can see how much
            free work you did.
          </p>
        ),
      },
    ],
  },
  {
    name: "Timers",
    items: [
      {
        q: "How do the timers work?",
        a: (
          <>
            <ol>
              <li>
                Go to <b>Timer</b> and tap <b>Start a timer</b>.
              </li>
              <li>
                Pick the RO you&apos;re working on. No RO yet? Tap{" "}
                <b>Start without an RO</b> and attach it later.
              </li>
              <li>Pick the line (op code) the time goes on.</li>
              <li>
                When the job is done, tap <b>Save</b>.
              </li>
            </ol>
            <p>
              You can run up to 3 timers, one per job, but only one can be
              on <b>Working</b> at a time. You only have one pair of hands.
            </p>
          </>
        ),
        go: { href: "/timer", label: "Open Timers" },
      },
      {
        q: "What do Parts and Approval do on a timer?",
        a: (
          <p>
            Tap <b>Parts</b> when you&apos;re waiting on parts, and{" "}
            <b>Approval</b> when you&apos;re waiting on the customer or the
            advisor. The clock stops counting it as work, and the waiting is
            saved as unpaid time on that RO. That&apos;s time you were stuck at
            the shop and not getting paid for, and the app keeps track of it.
            Tap <b>Working</b> when you&apos;re back on it.
          </p>
        ),
      },
      {
        q: "I forgot to stop a timer. How do I fix the time?",
        a: (
          <p>
            If you haven&apos;t saved it yet, tap <b>Reset</b> on the timer to
            throw that time away and start over. If you already saved it, open
            the RO from <b>History</b> and type the right number into the{" "}
            <b>Actual</b> box on that line.
          </p>
        ),
      },
    ],
  },
  {
    name: "Pay and paychecks",
    items: [
      {
        q: "How do I set my pay rate and my goal?",
        a: (
          <p>
            Go to <b>Settings</b>. <b>Pay Rates</b> is the first thing you see:
            type your flat rate for each kind of work you get paid on
            (Customer Pay, Warranty, Internal, Used Car) and save. Your hours goal for
            the pay period is under <b>Pay Period Goal</b>. With both set, the
            Dashboard shows what you&apos;ve earned and whether you&apos;re on
            pace.
          </p>
        ),
        go: { href: "/settings?section=pay-rates", label: "Open Pay Rates" },
      },
      {
        q: "How do I check if my paycheck is right?",
        a: (
          <ol>
            <li>
              When you get your stub, go to <b>Pay Period</b> and use the arrows
              to pick that pay period.
            </li>
            <li>
              Under <b>Check the pay</b>, open <b>Did I get paid?</b>
            </li>
            <li>
              Type in the flag hours your stub says you were paid for (
              <b>Actual paid flag hrs</b>).
            </li>
            <li>
              The app compares it with what you logged. If it&apos;s short,
              open <b>Which lines came up short?</b> to see exactly which ROs
              are missing.
            </li>
          </ol>
        ),
        go: { href: "/pay-period", label: "Open Pay Period" },
      },
      {
        q: "My pay period dates are wrong. How do I change them?",
        a: (
          <>
            <p>
              For every pay period: go to <b>Settings</b>, then{" "}
              <b>Pay Period Defaults</b>, and set how your shop splits the
              month.
            </p>
            <p>
              For just one period (a holiday, a one-off change): go to{" "}
              <b>Pay Period</b>, pick the period, and tap{" "}
              <b>Set custom dates</b>.
            </p>
          </>
        ),
        go: { href: "/settings?section=period", label: "Open Pay Period Defaults" },
      },
    ],
  },
  {
    name: "Your account and your data",
    items: [
      {
        q: "Can my shop or my boss see my numbers?",
        a: (
          <>
            <p>
              No. Your ROs, hours and pay are in your account, and only you
              can see them.
            </p>
            <p>
              The one thing that ever leaves your account is <b>True Time</b>,
              and only if it&apos;s on. It shares the op code, the vehicle, and
              the book and actual hours on a job, so real job times can be
              pooled across techs. It never shares your name, your shop, RO
              numbers, customer info or exact dates. It&apos;s on by default
              for new accounts. You can turn it off any time in Settings under{" "}
              <b>Contribute to True Time</b>, and turning it off deletes what
              you&apos;ve already shared.
            </p>
          </>
        ),
        go: { href: "/settings?section=true-time", label: "Open True Time setting" },
      },
      {
        q: "Can I use this without making an account?",
        a: (
          <p>
            Yes. Tap <b>Try as Guest</b> at the bottom of the sign-in page.
            Guest mode works, but everything stays on that one phone or browser.
            Clear your browser or switch phones and it&apos;s gone. Make a free
            account to keep it: your guest ROs can come with you when you sign
            up.
          </p>
        ),
      },
      {
        q: "How do I make a backup of my data?",
        a: (
          <p>
            Go to <b>Settings</b>, then <b>Backup</b>, and tap{" "}
            <b>Download backup</b>. That saves a file with everything you&apos;ve
            logged. Keep it somewhere safe, like your email or cloud storage.
            It&apos;s your record, and it should never live in only one place.
          </p>
        ),
        go: { href: "/settings?section=backup", label: "Open Backup" },
      },
      {
        q: "I forgot my password.",
        a: (
          <p>
            On the sign-in page, tap <b>Forgot your password?</b> under the Sign
            in button. Type your email and we&apos;ll send you a link to set a
            new one. The link works on any phone or computer, but it only works
            once and it expires, so use it soon. Don&apos;t see the email? Check
            your spam folder.
          </p>
        ),
      },
      {
        q: "How do I change my email, name or password?",
        a: (
          <p>
            Open the menu and tap <b>Account</b>. Your name, email and password
            are all there. To change your password you&apos;ll need your current
            one.
          </p>
        ),
        go: { href: "/account", label: "Open Account" },
      },
      {
        q: "The screen is too dark (or too bright). Can I change it?",
        a: (
          <p>
            Yes. Go to <b>Settings</b>, then <b>Appearance</b>. Pick a theme
            (Light, Dark, Graphite or Pitch) and an accent color. It&apos;s
            saved to your account, so it follows you to any phone you sign in
            on.
          </p>
        ),
        go: { href: "/settings?section=appearance", label: "Open Appearance" },
      },
      {
        q: "Something looks wrong or broken. What do I do?",
        a: (
          <p>
            Tap <b>Report a Bug</b> at the bottom of any page. Tell us what you
            were doing and what happened, and add a screenshot if you can.
            Reports go straight to the person who builds the app.
          </p>
        ),
      },
      {
        q: "I wish the app did something it doesn't. Can I ask for it?",
        a: (
          <p>
            Yes. Tap <b>Request a Feature</b> at the bottom of any page and say
            what you want and what it would save you on a real day. Almost
            everything in the app started as something a tech needed at work.
            Every request gets read.
          </p>
        ),
      },
    ],
  },
];

function Chevron() {
  return (
    <svg className="ic ic-sm inf-chev" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M5.5 7.5L12 14l6.5-6.5 1.8 1.8L12 17.6 3.7 9.3z" />
    </svg>
  );
}

export default function FaqPage() {
  const count = GROUPS.reduce((n, g) => n + g.items.length, 0);
  return (
    <main className="inf-page">
      <div className="pagehead">
        <div className="grow">
          <h1>FAQ</h1>
          <p>
            Common questions, plain answers. Tap a question to open it.
          </p>
        </div>
      </div>

      {GROUPS.map((g) => (
        <Zone key={g.name} name={g.name} aside={<><span className="num">{g.items.length}</span> questions</>}>
          <div className="inf-faqs">
            {g.items.map((f) => (
              <details key={f.q} className="inf-faq">
                <summary>
                  <span className="inf-q">{f.q}</span>
                  <Chevron />
                </summary>
                <div className="inf-a">
                  {f.a}
                  {f.go && (
                    <Link href={f.go.href} className="inf-go">
                      {f.go.label}
                      <svg className="ic ic-sm" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                        <path d="M5.5 7.5L12 14l6.5-6.5 1.8 1.8L12 17.6 3.7 9.3z" />
                      </svg>
                    </Link>
                  )}
                </div>
              </details>
            ))}
          </div>
        </Zone>
      ))}

      <Zone name="Still stuck?">
        <p className="inf-text">
          If your question isn&apos;t here ({count} answered so far), send it in.
          The same button works for questions and for bugs.
        </p>
        <div className="inf-actions">
          <ReportBugButton label="Ask a question" />
          <RequestFeatureButton />
        </div>
      </Zone>
    </main>
  );
}
