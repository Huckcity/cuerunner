// The one address the shop front publishes.
//
// Two pages speak for the seller — the price page and the support page — and both name the same
// inbox. A second copy is an address that drifts from the one being read: one that reaches
// nobody. It lives here, once, and the pages import it: `website/docs/pricing.mjs` takes it from
// this file, and `support.mjs` takes it too, so there is nothing on the site that types an
// address of its own.
//
// The reply time used to live here as well, as one phrase two pages promised. It is gone: a
// turnaround is a promise about how fast a person works, the site does not need one to answer
// "who do I write to", and a number that is on the site is a number a buyer holds the seller to.
// What the pages say instead is where to write.
//
// The seller block is declared here too, and scripts/seller-block.test.ts holds every served
// page to it.
//
// scripts/trial-page.test.ts and scripts/support-page.test.ts read the address as data and hold
// each rendered page to it — one live value, and no second address anywhere — so a page cannot
// ship an address that does not exist. scripts/pricing-page.test.ts reads ORDER_EMAIL here too,
// rather than from the page module it used to be declared in.

/**
 * The one inbox everything lands in: an order, a trial request, a support question, a refund.
 * One person answers it.
 *
 * Live: Cloudflare Email Routing on `cuerunner.app` forwards this address to the person who
 * answers it — the same route the price page published for purchase orders, which the trial
 * and support pages now name for what they are for. The guards hold it to one live address: an
 * empty value, a placeholder and a markup-bearing one all fail by name.
 */
export const ORDER_EMAIL = 'orders@cuerunner.app'

/**
 * Who the buyer is dealing with. The settled seller block, from the company's own record: the
 * name, the company number and the registered office, in that order, exactly as the register
 * carries them.
 *
 * It is declared here and rendered from here — the shared footer of every page on the site
 * takes it from this file — because a seller named differently on two pages, or named nowhere,
 * is the one defect a website cannot argue its way out of: the company's own record is what a
 * buyer, a bank and a code-signing authority check the site against.
 *
 * Two settled facts are deliberately absent. There is no VAT line (the company is not
 * registered), and the contact address is not repeated here: `ORDER_EMAIL` is the one address
 * the shop front publishes, and the support page is held to naming exactly that one.
 */
export const SELLER = {
  name: 'ALGD LTD',
  number: 'NI744090',
  address: '121 Glencam Road, Omagh, Tyrone, BT79 7HB, United Kingdom'
}

/** The block as the pages print it. */
export const SELLER_BLOCK =
  `Cuerunner is provided by ${SELLER.name}, company number ${SELLER.number}, ${SELLER.address}.`
