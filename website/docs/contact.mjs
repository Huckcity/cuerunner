// The one address the site publishes, and the company behind it. A second copy is an address
// that drifts from the one being read, so the pages import it from here.
// scripts/seller-block.test.ts holds every served page to the block below.

/** Where a question or a problem report is sent. */
export const ORDER_EMAIL = 'orders@cuerunner.app'

/**
 * Who provides the site and the official builds: the name, the company number and the registered
 * office, exactly as the register carries them. The shared footer of every page takes it from here.
 */
export const SELLER = {
  name: 'ALGD LTD',
  number: 'NI744090',
  address: '121 Glencam Road, Omagh, Tyrone, BT79 7HB, United Kingdom'
}

/** The block as the pages print it. */
export const SELLER_BLOCK =
  `Cuerunner is provided by ${SELLER.name}, company number ${SELLER.number}, ${SELLER.address}.`
