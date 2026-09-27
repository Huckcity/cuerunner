// The facts the one commercial page states, and nothing that speaks for a page of its own: how
// long a trial runs, what it turns on, how a key arrives, how it is entered, and what an ended
// key leaves behind. `website/docs/pricing.mjs` renders them.
//
// Every fact here is one a reader acts on, and none of them is typed into the markup — each is
// declared here and the page renders it — and scripts/trial-page.test.ts reads each one back
// out of its source: the app's own files (`src/shared/fileMenu.ts`, `SettingsDialog.tsx`,
// `Toolbar.tsx`, `LicenseSection.tsx`) for the labels and the sentences,
// `src/main/license/key.ts` for the day a key is good through, the market record's adopted model
// for the length and the terms, and the README for what a lapsed key leaves, how a key arrives
// and how it is entered. A label that moves in the app fails the guard by name rather than
// shipping a page that sends a reader to a menu item that is not there.
//
// The address comes from `website/docs/contact.mjs`, where the support page takes it from too:
// the shop front names one address, from one place. No reply time is declared anywhere: the
// site says where to write and promises nothing about how fast the answer comes.

/**
 * The app's own words, each the string the app carries: the toolbar button the file menu opens
 * from (its label and the caret it draws beside it), the item that opens Settings, the tab a
 * key is entered under, the field's placeholder, the button that enters it, and the two
 * sentences the License tab shows — the one under the field, and the one it shows once a key
 * has run out. The page renders them as its own words, so the reader meets the same labels in
 * the page and in the window, and the guard reads each back out of the app's source and refuses
 * a copy that is not the app's.
 */
export const APP = {
  menu: 'Cuerunner',
  caret: '▾',
  settings: 'Settings…',
  tab: 'License',
  field: 'Paste the key from your purchase',
  activate: 'Activate',
  offline: 'Checked on this machine, so a show computer never needs the internet.',
  ended: 'The Pro half is off until a renewed key is entered; your shows and the cue stack keep working.'
}

/**
 * The trial as the record decides it: D2's adopted model is the only place the length and the
 * terms are set — "**14-day free trial key**, full Pro, self-serve, offline" — so the page
 * states them from here. The guard reads that bullet back for both: the days it writes and
 * every term it sets, so a trial that changes length, or stops being full Pro, fails the guard
 * rather than the reader.
 */
export const TRIAL_LENGTH = 14

/**
 * The terms that bullet sets, as the words the page has to carry for them: the trial costs
 * nothing, it is the whole Pro half, the visitor asks for it themselves, and the key is checked
 * without a network.
 */
export const TRIAL_TERMS = ['free', 'full Pro', 'self-serve', 'offline']

/**
 * How a key arrives. A request is not a checkout and not an in-app trial: the README's
 * fulfilment sequence is that a person mints the key with `npm run license:issue` and delivers
 * it by email, and the guard holds both halves — minting and email delivery — to that sequence
 * and to this sentence, so a page that promises a form or an instant unlock fails by name.
 */
export const KEY_DELIVERY = `A person mints the key for you and it comes back by email. There is no checkout and no account in between.`

/**
 * What entering the key takes, in the README's own terms for it: entered once, on the machine
 * it is entered on. The guard holds it to the licence bullet that says so, so the page cannot
 * grow a step the app does not need — or a promise about how many machines a trial covers,
 * which is not the record's to make here.
 */
export const ENTRY_NOTE = `Enter it once and that is the whole of it: the key is checked on the machine it is entered on, there is nothing to install to receive it, and there is no account to sign into.`

/**
 * The steps that turn the key on, in the app's own labels: the file menu, the tab, the field,
 * the button, and the sentence the app puts under them. The page renders this list as its
 * steps, and the guard holds each of the app's strings to the app's own files — the page cannot
 * point at a menu item, a tab or a button that has moved.
 */
export const ACTIVATION_STEPS = [
  `Open <strong>${APP.menu} ${APP.caret} → ${APP.settings}</strong> and choose the <strong>${APP.tab}</strong> tab.`,
  `Paste the key into the field the tab offers for it — <em>${APP.field}</em> is what the empty box says — and press <strong>${APP.activate}</strong>.`,
  `${APP.offline} Nothing is sent anywhere when you press it, and there is no account behind it.`
]

/**
 * What the key does at its end, and what it leaves: the last day a key is good through (the
 * app's own rule, `src/main/license/key.ts` — the whole of the last day, in UTC), what the
 * README's licence bullets and trial paragraph say a lapsed key leaves and a renewed one
 * restores. Each sentence carries the source's own words, and the guard reads them back.
 */
export const END_OF_KEY = [
  `A trial is a key that lapses, and so is a rental: each one is good for the whole of its last day, in UTC.`,
  `When the last day passes, the machine is the free app again, with the show file untouched: the scenes, the mic plot and the triggers written during the trial stay in it, and the cue stack plays on.`,
  `A renewed key — a licence, a rental, another trial — brings the Pro half back on the spot, without a restart and with nothing to reinstall.`
]

/**
 * When the days start, and what a request has to carry for the key to be minted at all. The
 * start is the mint, not the first launch: the seller sets the last day when the key is made,
 * which is the README's own account of a request — the guard holds this sentence to it. The
 * name is not decoration: the key is issued to one (`scripts/license-keygen.ts` refuses to mint
 * without it, "A license needs a name"), and it is what the License tab reads back, so a
 * request that does not say it comes back as a question rather than a key.
 */
export const TRIAL_STARTS = `The ${TRIAL_LENGTH} days run from the day the key is minted — the day it is sent to you — and not from the first time you open the app.`
export const KEY_NAME = `Say who the key is for: every key carries the name it is issued to, and the License tab reads it back to you.`
