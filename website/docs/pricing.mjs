// The price page: what Cuerunner Pro costs, and the routes that buy it.
//
// Money is the one thing on this page a buyer must be able to trust, so no figure is written
// here that the record does not set: the adopted model in
// `_bmad-output/specs/spec-cuerunner/market-and-business.md` (decision D2) is the authority,
// the rows below are declared rather than typed into the markup, and
// scripts/pricing-page.test.ts reads this file's export against that section — each row names
// the bullet it prices and must carry that bullet's figures and terms, in the record's own
// notation.
//
// The routes are declared once for the same reason. Each is the seller's own, and two of them
// arrive after the page does: the storefront link and the inbox a purchase order goes to are
// declared empty, the guard fails by name while either is, and the fill is the fix rather
// than a relaxed check — the page never ships a placeholder where a checkout or an address
// should be. The W-9 is not a value and needs no fill: it comes back by email, so its route is
// the words that say so, declared once and rendered from here.
import { table } from './table.mjs'

/** A route as it may sit in an attribute: the characters markup would read, escaped. */
const attr = text => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * The card route, declared once and interpolated by every row that sells by card, so a moved
 * link is one edit here and the guard can hold the rendered page to the declaration.
 *
 * Live: the Stripe payment link for the $249 licence. It sells that one thing, so it is the
 * licence row's route alone — the renewal and the rental are conversations until they have
 * links of their own, because a checkout that cannot serve a row is a route that does not
 * exist. The guard holds it to a live `https://` link: an empty value, a placeholder and a
 * markup-bearing one all fail by name.
 */
export const CARD_LINK = 'https://buy.stripe.com/dRm5kD1l7gru2L8ciV5ZC01'

/**
 * The one inbox a purchase order goes to, and the only address this page names. Venue,
 * education and purchase-order buyers are stated as the route that exists — a person answering
 * — rather than dressed as a checkout that cannot serve them (AD-24's vocabulary).
 *
 * Live: Cloudflare Email Routing on `cuerunner.app` forwards this address to the person who
 * answers it, so an order sent here reaches a human. The guard holds it to one live address —
 * an empty value, a placeholder and a markup-bearing one all fail by name.
 */
export const ORDER_EMAIL = 'orders@cuerunner.app'

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
 * self-serve row that carries them.
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
 * - `route`, one of the route values this module declares, never a literal typed into the row.
 * - `conversation`, whether the purchase is a conversation rather than a checkout.
 */
export const PRICED_SKUS = [
  {
    label: 'Cuerunner Pro',
    record: '$249',
    figures: ['$249'],
    includes: `One perpetual licence: every Pro capability, 12 months of updates, and two machines — the one you run from and the one standing by.`,
    route: CARD_LINK,
    conversation: false
  },
  {
    label: 'Updates after the first year',
    record: '$49/yr',
    figures: ['$49/yr'],
    includes: `Optional. A licence does not stop when its year of updates does, and nothing in the app checks a renewal date — renewing adds the next 12 months to it.`,
    route: ORDER_EMAIL,
    conversation: true
  },
  {
    label: 'A rental',
    record: '$12/day',
    figures: ['$12/day', '$99/90 days'],
    includes: `The same Pro half for a run or a season. Every dollar spent on a rental credits to a licence.`,
    route: ORDER_EMAIL,
    conversation: true
  },
  {
    label: 'A venue or a campus',
    record: '$999',
    figures: ['$999', '$99/machine'],
    includes: `One key for up to ten machines, and per-machine pricing past the tenth, for a venue, a tour or a campus.`,
    route: ORDER_EMAIL,
    conversation: true
  },
  {
    label: 'Education',
    record: '50% off',
    figures: ['50% off'],
    includes: `Half price on every SKU, for schools, colleges and students.`,
    route: ORDER_EMAIL,
    conversation: true
  }
]

/**
 * One row as the page serves it: the label, the figures, what it includes and how it is bought.
 * The buy cell is the one place a route is rendered, so the conversation rows say which kind of
 * purchase they are and the self-serve rows are a link and nothing else, and the route is
 * escaped where it goes into `href` — a live link can carry an ampersand, and markup would
 * otherwise read it as one.
 */
function rowCells(row) {
  const buy = row.conversation
    ? `${BY_CONVERSATION} — <a href="mailto:${attr(row.route)}">${attr(row.route)}</a>`
    : `<a href="${attr(row.route)}">Buy with a card</a>`
  return [row.label, row.figures.join('<br />'), row.includes, buy]
}

export const PRICING = [
  {
    path: 'pricing.html',
    title: 'Pricing',
    blurb:
      'What Cuerunner Pro costs, and the routes that buy it: a storefront link for cards, purchase orders with a numbered invoice and a W-9, and education at half price.',
    body: `
    <section class="panel reveal">
      <h1>Pricing</h1>
      <p class="doc-lede">
        The free half of Cuerunner costs nothing: no key, no account, no expiry, on as many of
        your own machines as you like. Cuerunner Pro is the show around it — the desk, the
        radios, the tablet, the second machine and the handover — and it is one paid tier, sold
        two ways: by card, or on a purchase order.
      </p>
    </section>

    <section class="panel reveal delay-1">
      <h2>What Pro costs</h2>
      <p>
        Every way of buying Pro turns on the same things. There is no subscription, no cue cap
        and no watermark, and a licence is not a lease: what the price decides is how long
        updates come and how many machines it covers.
      </p>
${table(['What you buy', 'Price', 'What it includes', 'How to buy'], PRICED_SKUS.map(rowCells))}
    </section>

    <section class="panel reveal delay-2">
      <h2>Buying on paper</h2>
      <p>
        Purchase orders are welcome, and nothing here needs an account first. Send yours to
        <a href="mailto:${attr(ORDER_EMAIL)}">${attr(ORDER_EMAIL)}</a> and we reply with a
        numbered invoice for your finance office. ${W9_ROUTE}
      </p>
      <p class="note">
        The venue, the campus and the education rows are a conversation rather than a checkout:
        that address is the one place to ask about an order, an invoice or a W-9, and one
        person answers it.
      </p>
    </section>

    <section class="panel reveal delay-3">
      <h2>After you pay</h2>
      <p>
        We email your key after the payment or the purchase order is settled — nothing to
        activate online, and no account to make first. Enter it once in
        <strong>Cuerunner ▾ → Settings… → License</strong>: the key is checked on the machine it
        is entered on, and using it tells nobody that it was used, so a venue machine with no
        internet unlocks exactly like any other. A key is not bound to one computer, and the
        free half keeps working whatever happens to it.
      </p>
    </section>
`
  }
]
