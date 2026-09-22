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
// The routes are declared once for the same reason. Each is the seller's own and live: the
// card links are the storefront's per-SKU payment links, the address is the inbox a purchase
// order goes to — declared in `website/docs/contact.mjs`, where the trial and support pages
// take it from too, so the shop front names one address from one place — and the guard fails
// by name on a route that is empty, a placeholder or carries markup: the page never ships a
// checkout or an address that does not exist. The W-9 is not a value and needs no fill: it
// comes back by email, so its route is the words that say so, declared once and rendered from
// here.
//
// The app's own labels are declared here for the same reason: the sentence that sends a reader to
// the control a key is entered in names four words the app owns — the toolbar's brand and its
// caret, the File menu's item and the License tab — so it is composed from those labels rather
// than typed, and scripts/pricing-page.test.ts reads each one out of the file that declares it. An
// app rename fails the guard rather than leaving the page pointing at a control that moved.
import { attr } from './attr.mjs'
import { ORDER_EMAIL } from './contact.mjs'
import { table } from './table.mjs'

/**
 * The card routes, one live Stripe payment link per SKU, declared once and interpolated by the
 * row that sells it, so a moved link is one edit here and the guard can hold the rendered page
 * to the declaration. Each link sells that one thing — the $249 licence, the $49 renewal, a
 * day's rental, the 90-day rental — in US dollars, one-time, with no subscription behind it.
 *
 * The guard holds every one to a live `https://` link: an empty value, a placeholder and a
 * markup-bearing one all fail by name, and a declared link no row sells (or two rows selling
 * one link) fails too.
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
        <strong>${KEY_PATH}</strong>: the key is checked on the machine it
        is entered on, and using it tells nobody that it was used, so a venue machine with no
        internet unlocks exactly like any other. A key is not bound to one computer, and the
        free half keeps working whatever happens to it.
      </p>
    </section>
`
  }
]
