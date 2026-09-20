// The trial page: what a buyer can try before paying, for how long, and how to turn it on.
//
// The page is the shop front's answer to "can I try it first", and every fact on it is one a
// reader acts on: how long the trial lasts, what it turns on, the address a request goes to,
// the app's own menu item, tab, field and button, the sentence the app shows under the field,
// and what an ended key leaves behind. None of them is typed into the markup — each is declared
// here and the page renders it — and scripts/trial-page.test.ts reads each one back out of its
// source: the app's own files (`src/shared/fileMenu.ts`, `SettingsDialog.tsx`,
// `Toolbar.tsx`, `LicenseSection.tsx`) for the labels and the sentences, `src/main/license/key.ts`
// for the day a key is good through, the market record's adopted model for the length and the
// terms, and the README for what a lapsed key leaves, how a key arrives and how it is entered.
// A label that moves in the app fails the guard by name rather than shipping a page that sends
// a reader to a menu item that is not there.
//
// The address and the reply come from `website/docs/contact.mjs`, where the support page takes
// them from too: the shop front names one address and promises one turnaround, from one place.
import { attr } from './attr.mjs'
import { ORDER_EMAIL, REPLY_WITHIN } from './contact.mjs'

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
export const KEY_DELIVERY = `A person mints the key for you — the same tool every order is fulfilled with — and it comes back by email. There is no checkout and no account in between.`

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
  `A trial is a key that lapses, and so is a rental: each one is good for the whole of its last day, in UTC. A show that opens on the day the key runs out is not stopped mid-performance because the venue is east of the person who minted it.`,
  `When the last day passes the machine falls back to the free half, with the show file untouched: the scenes, the mic plot and the triggers written during the trial are still in it, and the cue stack plays on as it always did.`,
  `Enter a renewed key — a licence, a rental, another trial — and the Pro half comes back on the spot, without a restart and without reinstalling anything.`
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
export const KEY_NAME = `Say who the key is for, too: every key carries the name it is issued to, and that is the name the License tab reads back to you.`

export const TRIAL = [
  {
    path: 'trial.html',
    title: 'Try Cuerunner Pro',
    blurb: `${TRIAL_LENGTH} days of the whole Pro half, free: ask for a key at the one address, enter it once, and run a real show with it before you decide anything.`,
    body: `
    <section class="panel reveal">
      <h1>Try Cuerunner Pro</h1>
      <p class="doc-lede">
        ${TRIAL_LENGTH} days of the whole Pro half, free, on your own machine: the desk, the
        radios, the tablet and the second machine. Ask for a key, enter it once, and find out
        on a real show rather than on a demo.
      </p>
    </section>

    <section class="panel reveal delay-1">
      <h2>What the trial is</h2>
      <p>
        A trial key is a Pro key with a last day on it: everything a key turns on is open for
        the length of the trial, and the app behaves exactly as it does for someone who has
        paid — nothing watermarked, nothing capped, and nothing held back to make the point.
      </p>
      <ul class="tight-list">
        <li><strong>Full Pro, for ${TRIAL_LENGTH} days.</strong> The whole Pro half —
          <a href="pro.html">the free and Pro page</a> has the line, capability by
          capability — so what you test is what you would be buying.</li>
        <li><strong>Self-serve.</strong> Nothing to book and nobody to persuade: you write,
          the key is minted, and it arrives by email. No call, no card, no account first.</li>
        <li><strong>Offline.</strong> The key is checked on the machine it is entered on,
          against public keys compiled into the app. Nothing is sent anywhere, so a venue
          machine with no internet unlocks exactly like any other.</li>
      </ul>
      <p>
        ${TRIAL_STARTS}
      </p>
    </section>

    <section class="panel reveal delay-2">
      <h2>Ask for a key</h2>
      <p>
        Write to <a href="mailto:${attr(ORDER_EMAIL)}">${attr(ORDER_EMAIL)}</a> and say what
        you run and what you would like to try. ${KEY_NAME} ${KEY_DELIVERY} Like everything
        else sent to that address, a request is answered within ${REPLY_WITHIN}.
      </p>
      <p class="note">
        The key is not a card on file and nothing renews itself. When its last day passes the
        machine is the free app again, and there is nothing to cancel.
      </p>
    </section>

    <section class="panel reveal delay-3">
      <h2>Enter it</h2>
      <ol class="steps">
${ACTIVATION_STEPS.map(step => `        <li>${step}</li>`).join('\n')}
      </ol>
      <p class="note">
        ${ENTRY_NOTE}
      </p>
    </section>

    <section class="panel reveal delay-4">
      <h2>When the ${TRIAL_LENGTH} days are up</h2>
      <p>
        ${END_OF_KEY[0]}
      </p>
      <p class="note">
        ${APP.ended}
      </p>
      <p>
        ${END_OF_KEY[1]}
      </p>
      <p>
        ${END_OF_KEY[2]}
      </p>
      <p>
        If you decide to keep it, the <a href="pricing.html">price page</a> has the ways to
        buy — a card, a purchase order, or a rental for a run — and the
        <a href="pro.html">free and Pro page</a> has the line the key turns on.
      </p>
    </section>
`
  }
]
