// About: who builds the app and why it exists, in the builder's own voice.
// First person on purpose: it is one tech, not a company. Styles: page-info.css.
import { Zone } from "@/components/ui/Zone";

export default function AboutPage() {
  return (
    <main className="inf-page inf-about">
      <div className="pagehead">
        <div className="grow">
          <h1>About Us</h1>
          <p>Who builds this, and why it exists.</p>
        </div>
      </div>

      <Zone name="Who builds it">
        <div className="inf-prose">
          <p className="inf-lead">
            I&apos;m Liem. I&apos;m a flat rate line tech at a dealership in Los
            Angeles, and I build this app on my own time.
          </p>
          <p>
            Nobody taught me to code. I learned it the same way I learned the
            trade: doing it over and over, watching people who knew more than
            me, and not trusting anything until I understood why it works. I
            run my own server at home, and that&apos;s where this app lives.
          </p>
        </div>
      </Zone>

      <Zone name="Why it exists">
        <div className="inf-prose">
          <p>
            Flat rate pays on flagged hours, not on the hours you spend at the
            shop. The shop keeps the record of what you flagged. Most techs
            keep nothing. So when a line goes missing from a check, it&apos;s
            your memory against their printout, and the printout wins.
          </p>
          <p>
            I wanted my own record. I looked for something that did it and
            couldn&apos;t find anything built for how we actually work: on a
            phone, in the bay, between jobs, with dirty hands. So in April 2026
            I started building one.
          </p>
        </div>
      </Zone>

      <Zone name="How it came together">
        <div className="inf-prose">
          <p>
            It started as a way to log my own ROs. Then I wanted to know if I
            was on pace for the period. Then I wanted to hold my pay stub up
            against it. Then came the timers, because waiting on parts and
            approvals is time nobody pays you for, and nobody counts.
          </p>
          <p>
            Almost everything in here started as something I needed on a real
            day at work. If it&apos;s in the app, it&apos;s because a tech
            needed it.
          </p>
        </div>
      </Zone>

      <Zone name="What it stands for">
        <ol className="inf-rules">
          <li>
            <b>Your record is yours.</b>
            <span>
              Your shop can&apos;t see it, and nothing in it gets changed behind
              your back. You can download all of it any time.
            </span>
          </li>
          <li>
            <b>The real number, even when it&apos;s bad news.</b>
            <span>
              A number that looks good but hides a short check is worse than
              no number at all.
            </span>
          </li>
          <li>
            <b>Built for the bay.</b>
            <span>
              Phone first, big buttons, and fast enough to log a job before the
              next car rolls in.
            </span>
          </li>
        </ol>
      </Zone>

      <Zone name="Where it's going">
        <div className="inf-prose">
          <p>
            Book time is a guess somebody made in an office. Every RO logged in
            here is a real job done by a real tech, and together they can show
            how long the work actually takes. That&apos;s the idea behind{" "}
            <b>True Time</b>, and it&apos;s only possible because techs like
            you log real jobs as they happen.
          </p>
          <p>
            If something&apos;s broken, or there&apos;s something you wish it
            did, tell me. <b>Report a Bug</b> and <b>Request a Feature</b> at
            the bottom of every page both come straight to me, and every one
            gets read.
          </p>
          <p className="inf-sign">Liem</p>
        </div>
      </Zone>
    </main>
  );
}
