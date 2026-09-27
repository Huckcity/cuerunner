// The one commercial page: the free/Pro line, what Pro costs, and the trial.
//
// Three pages used to say this — "Free and Pro", "Pricing" and "Trial" — and a buyer had to
// read all three to answer one question, because each of them assumed the other two. They are
// one page now: the rows come from `website/docs/pro.mjs`, the trial's facts from
// `website/docs/trial.mjs`, and the prices from here, so the modules still declare and a single
// page renders.
//
// Money is the one thing on this page a buyer must be able to trust, so no figure is written
// here that the record does not set: the adopted model in
// `_bmad-output/specs/spec-cuerunner/market-and-business.md` (decision D2) is the authority,
// the rows below are declared rather than typed into the markup, and
// scripts/pricing-page.test.ts reads this file's export against that section — each row names
// the bullet it prices and must carry that bullet's figures and terms, in the record's own
// notation.
//
// The routes are declared once for the same reason. Each is the seller's own and live: the
// card links are the storefront's per-SKU payment links, the address is the inbox a purchase
// order goes to — declared in `website/docs/contact.mjs`, where the support page takes it from
// too, so the shop front names one address from one place — and the guard fails by name on a
// route that is empty, a placeholder or carries markup: the page never ships a checkout or an
// address that does not exist. The W-9 is not a value and needs no fill: it comes back by
// email, so its route is the words that say so, declared once and rendered from here.
//
// The app's own labels are declared here for the same reason: the sentence that sends a reader to
// the control a key is entered in names four words the app owns — the toolbar's brand and its
// caret, the File menu's item and the License tab — so it is composed from those labels rather
// than typed, and scripts/pricing-page.test.ts reads each one out of the file that declares it. An
// app rename fails the guard rather than leaving the page pointing at a control that moved.
import { attr } from './attr.mjs'
import { ORDER_EMAIL } from './contact.mjs'
import { FREE_ROWS, PRO_ROWS } from './pro.mjs'
import { table } from './table.mjs'
import {
  ACTIVATION_STEPS,
  ENTRY_NOTE,
  END_OF_KEY,
  KEY_DELIVERY,
  KEY_NAME,
  TRIAL_LENGTH,
  TRIAL_STARTS
} from './trial.mjs'

/**
 * The card routes, one live Stripe payment link per SKU, declared once and interpolated by the
 * rows below. A row's link sells that row's SKU and nothing else, so a link is never shared and
 * never typed twice — the guard reads every `href` on the rendered page back against this table,
 * and fails a card row that offers something the declaration does not hold (or nothing at all).
 * Each value is the seller's own live checkout: an empty string, a placeholder host like
 * `example.com`, or a value that carries markup all fail by name.
 */
export const CARD_LINKS = {
  licence: 'https://buy.stripe.com/dRm5kD1l7gru2L8ciV5ZC01',
  renewal: 'https://buy.stripe.com/fZu3cv8Nz4IM4Tg1Eh5ZC02',
  rentalDay: 'https://buy.stripe.com/8x24gz3tf5MQ99w0Ad5ZC03',
  rental90: 'https://buy.stripe.com/bJe28r0h3b7a2L85Ux5ZC04'
}

/**
 * The W-9, declared once: an institution asks for one and the completed form comes back by
 * email with the numbered invoice, so there is no document to link and no value to fill. The
 * page renders this sentence from here, and the guard holds the rendered page to it.
 */
export const W9_ROUTE = 'The completed W-9 comes back by email with the invoice.'

/**
 * How a row whose purchase is a conversation says so. A venue and a campus are sold against a
 * quote rather than a checkout, and a page that dressed them as one would claim a route that
 * cannot serve them; the guard fails a conversation row that does not carry these words, and a
 * card row that carries them.
 */
export const BY_CONVERSATION = 'Talk to us'

/**
 * The priced SKUs, one row each, in the order the page names them:
 *
 * - `label`, the words a buyer reads in the first column.
 * - `record`, the phrase the D2 bullet for this row leads with: the binding that says which
 *   price the row is the page's statement of, so a figure that moves to another row fails.
 * - `figures`, the Price column as the record writes it — `$12/day` and `$99/90 days`, not
 *   rounded prose — so a figure keeps its unit and two figures that read alike stay apart.
 * - `includes`, what the price includes, in the record's terms (the 12 months, the machines)
 *   and in the buyer's words.
 * - `buy`, how the row is bought: a card row names its links, each drawn from `CARD_LINKS`
 *   with the words a buyer reads on it (`Buy a day`, `Buy 90 days`), and a conversation row
 *   names the address a person answers. One link sells one SKU, so a row that shares a link
 *   with another, or offers one the declaration does not hold, fails the guard by name.
 */
export const PRICED_SKUS = [
  {
    label: 'Cuerunner Pro',
    record: '$249',
    figures: ['$249'],
    includes: `One perpetual licence: every Pro capability, 12 months of updates, and two machines — the one you run from and the one standing by.`,
    buy: { kind: 'card', links: [{ words: 'Buy with a card', href: CARD_LINKS.licence }] }
  },
  {
    label: 'Updates after the first year',
    record: '$49/yr',
    figures: ['$49/yr'],
    includes: `Optional. A licence does not stop when its year of updates does, and nothing in the app checks a renewal date — renewing adds the next 12 months to it.`,
    buy: { kind: 'card', links: [{ words: 'Buy with a card', href: CARD_LINKS.renewal }] }
  },
  {
    label: 'A rental',
    record: '$12/day',
    figures: ['$12/day', '$99/90 days'],
    includes: `The same Pro half for a run or a season. Every dollar spent on a rental credits to a licence.`,
    buy: {
      kind: 'card',
      links: [
        { words: 'Buy a day', href: CARD_LINKS.rentalDay },
        { words: 'Buy 90 days', href: CARD_LINKS.rental90 }
      ]
    }
  },
  {
    label: 'A venue or a campus',
    record: '$999',
    figures: ['$999', '$99/machine'],
    includes: `One key for up to ten machines, and per-machine pricing past the tenth, for a venue, a tour or a campus.`,
    buy: { kind: 'conversation', address: ORDER_EMAIL }
  },
  {
    label: 'Education',
    record: '50% off',
    figures: ['50% off'],
    includes: `Half price on every SKU, for schools, colleges and students.`,
    buy: { kind: 'conversation', address: ORDER_EMAIL }
  }
]

/**
 * The app's own labels for the way to a key, in the order the page's sentence walks them: the
 * toolbar's brand, the caret that opens its menu, the File menu's item and the tab a key is
 * entered on. They are the app's words —
 * `src/renderer/src/components/layout/Toolbar.tsx`, `src/shared/fileMenu.ts` and
 * `src/renderer/src/components/layout/SettingsDialog.tsx` — and the guard reads each one out of
 * the file that declares it, so this page states them rather than remembering them.
 */
export const BRAND = 'Cuerunner'
export const BRAND_CARET = '▾'
export const SETTINGS_ITEM = 'Settings…'
export const LICENSE_TAB = 'License'

/**
 * The path as the page states it: the labels above, joined in the order a reader follows them. The
 * arrow is the page's own — the app has no such word — and the sentence is composed from the
 * labels, so a label that moves moves the sentence with it.
 */
const KEY_PATH = [`${BRAND} ${BRAND_CARET}`, SETTINGS_ITEM, LICENSE_TAB].join(' → ')

/**
 * One row's buy cell: the card rows' links, each with the words a buyer reads on it, joined by
 * a separator; the conversation rows' single address behind the phrase that says a person
 * answers. A route is escaped where it goes into `href` — a live link can carry an ampersand,
 * and markup would otherwise read it as one.
 */
function buyCell(row) {
  if (row.buy.kind === 'conversation') {
    return `${BY_CONVERSATION} — <a href="mailto:${attr(row.buy.address)}">${attr(row.buy.address)}</a>`
  }
  return row.buy.links.map(link => `<a href="${attr(link.href)}">${link.words}</a>`).join(' · ')
}

/** One row as the page serves it: the label, the figures, what it includes and how it is bought. */
function rowCells(row) {
  return [row.label, row.figures.join('<br />'), row.includes, buyCell(row)]
}

export const PRICING = [
  {
    path: 'pricing.html',
    title: 'Pricing',
    blurb:
      'Cuerunner is free to run a show. Cuerunner Pro is one paid tier — the desk, the radios, the tablet and the second machine — with a trial before you pay, by card or on a purchase order.',
    body: `
    <section class="panel reveal">
      <h1>Pricing</h1>
      <p class="doc-lede">
        The app is free to run a show: no key, no account, no expiry, on as many of your own
        machines as you like. Cuerunner Pro is one paid tier — the desk, the radios, the
        tablet and the second machine — and the whole of it can be tried first.
      </p>
    </section>

    <section class="panel reveal delay-1">
      <h2>What is free</h2>
${table(['What you get', 'Details'], FREE_ROWS.map(row => [row.label, row.free.prose]))}
    </section>

    <section class="panel reveal delay-2">
      <h2>What Pro adds</h2>
${table(['Capability', 'Free', 'Pro'], PRO_ROWS.map(row => [row.label, row.free.prose, row.pro.prose]))}
    </section>

    <section class="panel reveal delay-3">
      <h2>Prices</h2>
${table(['What you buy', 'Price', 'What it includes', 'How to buy'], PRICED_SKUS.map(rowCells))}
      <p>
        A purchase order works as well as a card. Send one to
        <a href="mailto:${attr(ORDER_EMAIL)}">${attr(ORDER_EMAIL)}</a> and the reply is a
        numbered invoice for your finance office. ${W9_ROUTE}
      </p>
      <p class="note">
        A venue, a campus and a school are a conversation rather than a checkout, and the
        same address answers all three.
      </p>
    </section>

    <section class="panel reveal delay-3">
      <h2>Try it for ${TRIAL_LENGTH} days</h2>
      <p>
        Write to <a href="mailto:${attr(ORDER_EMAIL)}">${attr(ORDER_EMAIL)}</a> and say what
        you run and what you want to try. ${KEY_NAME} ${KEY_DELIVERY}
      </p>
      <ul class="tight-list">
        <li><strong>Full Pro, ${TRIAL_LENGTH} days.</strong> Everything a key turns on, so
          what you test is what you would buy.</li>
        <li><strong>Self-serve.</strong> Nothing to book: you write, the key is minted, and it
          arrives by email. No call, no card, no account first.</li>
        <li><strong>Offline.</strong> The key is checked on the machine it is entered on,
          against keys compiled into the app, so a venue machine with no internet unlocks like
          any other.</li>
      </ul>
      <p>
        ${TRIAL_STARTS}
      </p>
      <ol class="steps">
${ACTIVATION_STEPS.map(step => `        <li>${step}</li>`).join('\n')}
      </ol>
      <p class="note">
        ${ENTRY_NOTE}
      </p>
    </section>

    <section class="panel reveal delay-3">
      <h2>When a key ends</h2>
      <p>
        ${END_OF_KEY[0]}
      </p>
      <p>
        ${END_OF_KEY[1]}
      </p>
      <p class="note">
        ${END_OF_KEY[2]}
      </p>
    </section>

    <section class="panel reveal delay-3">
      <h2>Buying it, and entering it</h2>
      <p>
        The key is emailed once the payment or the purchase order is settled — there is nothing
        to activate online and no account to make first. Enter it in
        <strong>${KEY_PATH}</strong>: it is checked on the machine it is entered on, and
        entering it tells nobody, so a venue machine with no internet unlocks exactly like any
        other.
      </p>
      <p class="note">
        One key covers two machines — the one you run from and the one standing by — and the
        free half keeps working whatever happens to it. The rest, including taking a key off a
        machine, is on the <a href="support.html">support page</a>.
      </p>
    </section>
`
  }
]
