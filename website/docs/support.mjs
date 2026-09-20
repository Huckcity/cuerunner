// The support page: who answers, what is covered, and how a key comes off a machine.
//
// Procurement asks this before it buys — is there a person, and how long do they take — and a
// page that answers with a phone line that rings nowhere is worse than no page. So every fact
// here is one the seller can hold: one address, declared in `website/docs/contact.mjs` with the
// reply that goes with it, the app's own words for deactivation, and the rule the README states
// for a refund — the row the key was sold under is marked refunded, and the machine it was
// entered on is deactivated — published as a route rather than as terms, because there is no
// window and no policy to state.
//
// scripts/support-page.test.ts holds the page to each of those sources, refuses a second
// address or a turnaround the seller never agreed to, refuses a refund window or a set of
// refund terms on either page, and fails by name when the page drops one half of the coverage
// it owes a reader. The two coverage rows are the page's own statement — what a licence buys
// and what a question costs are the seller's commitments, and the guard holds them to being
// present, whole and rendered, not to a phrase in another file.
import { attr } from './attr.mjs'
import { ORDER_EMAIL, REPLY_WITHIN } from './contact.mjs'
import { table } from './table.mjs'

/**
 * What support covers, one row per half of the app, in the order a buyer meets them: the free
 * app first, then what a licence adds to the conversation. Both rows are rendered, and the
 * guard refuses a page that carries one and not the other: "the free app is supported" and
 * "a licence question is answered" are two different promises.
 */
export const COVERAGE = [
  {
    who: 'The free app',
    prose: `No key is needed to ask, and nothing about the free half is out of scope: a cue that will not fire, a device that will not open, an import that arrives wrong, or a show file you want to understand. The <a href="guide.html">guides</a> and the <a href="reference/index.html">reference</a> come first because they answer most of it in a minute, but there is a person at the address, not a form.`
  },
  {
    who: 'Cuerunner Pro',
    prose: `A licence question is answered by the same person, at the same address, within ${REPLY_WITHIN}: activating a key, moving one to another machine, a key that has run out or will not be accepted, a renewal, an invoice, a W-9, or a refund. A key does not buy a faster answer or a place in a queue — there is one inbox, and everyone who writes to it is in it.`
  }
]

/**
 * The app's own words for taking a key off a machine: where the switch is — the menu item and
 * the tab, the same two labels the trial page's steps walk a reader through — the button, and
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
export const REFUND_ROUTE = `A refund is the row the key was sold under marked refunded, plus your request to deactivate the machine it was entered on. There is no window to catch and no form to fill in, and nothing in the app has to check a key for it to be so — the ledger is what keeps the sale honest.`

export const SUPPORT = [
  {
    path: 'support.html',
    title: 'Support',
    blurb: `One address and a person behind it: what support covers for the free app and for Pro, a reply within ${REPLY_WITHIN}, how to deactivate a machine, and where a refund is asked for.`,
    body: `
    <section class="panel reveal">
      <h1>Support</h1>
      <p class="doc-lede">
        One address, and a person behind it. Write to
        <a href="mailto:${attr(ORDER_EMAIL)}">${attr(ORDER_EMAIL)}</a> and a reply comes back
        within ${REPLY_WITHIN} — whether you run the free app, are weighing up the trial, or
        hold a licence.
      </p>
    </section>

    <section class="panel reveal delay-1">
      <h2>What support covers</h2>
      <p>
        Neither half of the app is left to a forum, and a licence does not move you to the
        front of anything. What changes with a key is which questions are about the licence
        itself.
      </p>
${table(['Who is asking', 'What is covered'], COVERAGE.map(row => [row.who, row.prose]))}
    </section>

    <section class="panel reveal delay-2">
      <h2>Taking a key off a machine, and refunds</h2>
      <p>
        ${DEACTIVATION_PATH}
      </p>
      <p class="note">
        ${DEACTIVATION}
      </p>
      <p>
        <a href="mailto:${attr(ORDER_EMAIL)}">${attr(ORDER_EMAIL)}</a> is also where a refund
        is asked for. ${REFUND_ROUTE}
      </p>
    </section>

    <section class="panel reveal delay-3">
      <h2>Before you write</h2>
      <ul class="tight-list">
        <li>The <a href="reference/troubleshooting.html">troubleshooting reference</a> collects
          what most messages turn out to be: a cue that does not fire, a file that has moved, a
          device that dropped out mid-show, a trigger that is not being heard.</li>
        <li>A message that says what the app is, what you did and what happened is answered in
          one pass rather than three, and a line from the log is worth more than a description
          of the sound it made.</li>
      </ul>
      <p class="note">
        The trial page has the <a href="trial.html">activation steps</a> if the question is how
        to enter a key, and the <a href="pricing.html">price page</a> has the ways to buy.
      </p>
    </section>
`
  }
]
