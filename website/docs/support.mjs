// The support page: where to write, and what to read first.
//
// This page used to promise things — what is covered, and how quickly an answer comes. Both are
// gone. A support page owes a reader two facts: the address, and where to look before writing
// to it. A turnaround is a promise about how fast a person works, and a promise on a page is
// something a buyer is entitled to hold the seller to; the guides and the reference answer most
// of what arrives anyway.
//
// What stays is what a reader acts on: the one address, declared in `website/docs/contact.mjs`,
// the places to look first, and the two things that otherwise arrive as mail — taking a key off
// a machine, in the app's own words, and where a refund is asked for, in the README's own rule.
//
// scripts/support-page.test.ts holds the page to each of those sources: one address and no
// second one, the app's labels read back out of `src/shared/fileMenu.ts` and
// `SettingsDialog.tsx`, the refund rule's two halves read back out of the README, and no reply
// time, refund window or set of terms on the page.
import { attr } from './attr.mjs'
import { ORDER_EMAIL } from './contact.mjs'

/**
 * The app's own words for taking a key off a machine: where the switch is — the menu item and
 * the tab, the same two labels the pricing page's steps walk a reader through — the button, and
 * the note the License tab puts under it. The page renders the note verbatim, and the guard
 * reads every label back out of `src/shared/fileMenu.ts`, `SettingsDialog.tsx` and
 * `LicenseSection.tsx`, so the page cannot send anyone looking for a control that has moved.
 */
export const SETTINGS_ITEM = 'Settings…'
export const LICENSE_TAB = 'License'
export const DEACTIVATE = 'Deactivate'
export const DEACTIVATION = 'Deactivating puts this machine back to the free app. Your shows are untouched.'

/**
 * The sentence that says where the button is, declared rather than typed into the page beside
 * the labels: it is the only place a reader is told how to reach it, and the guard holds it to
 * the rendered page — a page that keeps the note about deactivation and loses the way to the
 * switch would otherwise read as complete.
 */
export const DEACTIVATION_PATH = `A key can be taken off a machine without asking anyone for permission. <strong>${SETTINGS_ITEM} → ${LICENSE_TAB}</strong> has a <strong>${DEACTIVATE}</strong> button, and this is what pressing it does:`

/**
 * The refund route, published the way the decision says — the address, and nothing else: the
 * README's "Refunds and deactivation" rule is that a refund is the ledger row marked refunded
 * plus a request to deactivate, so the page states both halves at the one address, the buyer's
 * among them. It carries no window and no terms, and the guard refuses either: it holds the
 * rule's two halves — the marked row and the request to deactivate — to the README and to this
 * sentence, and refuses a refund bound to a number of days, dressed as a policy, or stated as a
 * guarantee.
 */
export const REFUND_ROUTE = `A refund is the row the key was sold under marked refunded, plus a request to deactivate the machine it was entered on. There is no window to catch.`

/**
 * The app's own words for the report: the menu item that opens it and the three buttons under
 * it. The guard reads each back out of `src/shared/fileMenu.ts` and `ReportDialog.tsx`, so the
 * page cannot send anyone looking for a control that has moved.
 */
export const REPORT_ITEM = 'Report a Problem…'
export const REPORT_BUTTONS = ['Copy', 'Save…', 'Email…']

export const SUPPORT = [
  {
    path: 'support.html',
    title: 'Support',
    blurb: `One address and a person behind it, the guides and the reference to look at first, how to take a key off a machine, and where a refund is asked for.`,
    body: `
    <section class="panel reveal">
      <h1>Support</h1>
      <p class="doc-lede">
        Write to <a href="mailto:${attr(ORDER_EMAIL)}">${attr(ORDER_EMAIL)}</a>. One person
        reads it — an order, a trial request, a licence, or something in the app that is not
        doing what it should.
      </p>
    </section>

    <section class="panel reveal delay-1">
      <h2>Look here first</h2>
      <ul class="tight-list">
        <li>The <a href="reference/troubleshooting.html">troubleshooting reference</a>: a cue
          that will not fire, a file that has moved, a device that dropped out mid-show, a
          trigger that is not being heard.</li>
        <li>The <a href="guide.html">guides</a> build a show from nothing, and the
          <a href="reference/index.html">reference</a> has every cue type, field and setting.</li>
      </ul>
      <p class="note">
        A message that says what you did and what happened is answered in one pass rather than
        three, and a line from the log is worth more than a description of the sound it made.
      </p>
    </section>

    <section class="panel reveal delay-1">
      <h2>Report a problem</h2>
      <p>
        <strong>Cuerunner ▾ → ${REPORT_ITEM}</strong> builds the report for you and shows it
        in full before anything leaves: the version, the machine, what the audio engine says
        about itself, whether a key is active, the crash dumps Windows or macOS left, and the
        end of the session log. Say what happened in the box above it.
      </p>
      <p>
        <strong>${REPORT_BUTTONS[0]}</strong> and <strong>${REPORT_BUTTONS[1]}</strong> keep it
        on your machine. <strong>${REPORT_BUTTONS[2]}</strong> puts it on the clipboard and opens
        a message to <a href="mailto:${attr(ORDER_EMAIL)}">${attr(ORDER_EMAIL)}</a> for you to
        paste it into and send.
      </p>
      <p class="note">
        Cuerunner sends nothing itself, ever: no crash uploads, no usage counts. Your home
        folder is replaced by <code>~</code>; the report holds no cue names, no show contents
        and no key. Crash dumps are listed by name and are not included — attach one if asked.
      </p>
    </section>

    <section class="panel reveal delay-2">
      <h2>Keys</h2>
      <p>
        ${DEACTIVATION_PATH}
      </p>
      <p class="note">
        ${DEACTIVATION}
      </p>
      <p>
        Activating a key, moving one to another machine, a key that has run out, a renewal, an
        invoice or a W-9: ask at
        <a href="mailto:${attr(ORDER_EMAIL)}">${attr(ORDER_EMAIL)}</a>. So is a refund.
        ${REFUND_ROUTE}
      </p>
      <p class="note">
        Buying Pro, the prices and the trial are on the
        <a href="pricing.html">pricing page</a>, which also walks through entering a key.
      </p>
    </section>
`
  }
]
