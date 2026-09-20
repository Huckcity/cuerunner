// The trial page, held to the app it walks a reader through and to the record it quotes.
//
// `website/trial.html` is the only page that tells a buyer how to try Cuerunner Pro, and
// nothing read it: its steps were its own words, so a menu item renamed in the app, a tab moved
// or a sentence reworded in the licence panel would have shipped as a page that sends a reader
// looking for a control that is not there — and the length of the trial, which the record
// decides, would have drifted the same way. The page's facts are declarations now
// (website/docs/trial.mjs), so this guard can read each one against the file it comes from:
//
// - the app's own strings — the toolbar's `Cuerunner ▾` button, the `Settings…` item, the
//   `License` tab, the key field's placeholder, the `Activate` button, and the two sentences
//   the tab shows — read out of `Toolbar.tsx`, `src/shared/fileMenu.ts`, `SettingsDialog.tsx`
//   and `LicenseSection.tsx` as text, because a React component is not something this guard can
//   import;
// - the day a key is good through, read out of `src/main/license/key.ts`;
// - the length and the terms of the trial, read out of the adopted model in the market record
//   (`_bmad-output/specs/spec-cuerunner/market-and-business.md`, decision D2);
// - what a lapsed key leaves, how a key arrives and what entering one takes, read out of the
//   README (the trial paragraph, the licence bullets and `### Fulfilling an order`).
//
// **What the reading covers.** A fact is held both ways: the source must still say it, and the
// page must state it — the declared string where the page renders the app's words, the declared
// sentence where the page says it in its own, with the source's own words inside it. Beyond the
// facts, the page's promises are held: the address (the one live value, the only address on the
// page, and the only route off the site), the reply (`contact.mjs`'s one phrase, and no other
// turnaround anywhere on the page), every link (a relative href has to resolve, and the page
// names no channel that is not the address), and the primary nav of every page the site serves
// (the page must be one of its links).
//
// Every check is a pure function of what it reads, so the second describe can hand it a page
// the repository would never commit and get the failure back by name. The failure paths are
// what hold the page; a passing run on its own says only that nothing has drifted yet.
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// @ts-ignore — js file, no type declarations
import {
  ACTIVATION_STEPS,
  APP,
  END_OF_KEY,
  ENTRY_NOTE,
  KEY_DELIVERY,
  KEY_NAME,
  TRIAL,
  TRIAL_LENGTH,
  TRIAL_STARTS,
  TRIAL_TERMS
} from '../website/docs/trial.mjs'
// @ts-ignore — js file, no type declarations
import { ORDER_EMAIL, REPLY_WITHIN } from '../website/docs/contact.mjs'
// @ts-ignore — js file, no type declarations
import { NAV, renderPage } from '../website/build-docs.mjs'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

/** How a fact is read out of its source: the file's text in, the words it carries out. */
type Reader = (source: string) => string | undefined

/**
 * One fact the page states in another file's words. `exactly` where the page renders the
 * source's string as its own words (a label, a sentence the app shows); `within` where the
 * page says it in a sentence of its own that carries the source's phrase.
 */
interface Fact {
  what: string
  file: string
  read: Reader
  stated: string
  hold: 'exactly' | 'within'
}

/** Everything the checks read, in one value: a case below hands them a mutation of it. */
interface Reading {
  days: number
  terms: string[]
  facts: Fact[]
  /** The facts the page and its source state in different words, held by a pattern on each side. */
  pairs: PairFact[]
  /** What the module declares and the page renders: the steps, the sentences, and the app's own two. */
  declared: string[]
  address: string
  reply: string
  /** The adopted model's bullets, which is every length and term the page may state. */
  bullets: string[]
  /** The README's trial-request paragraph, which is where the seller's own account of one lives. */
  request: string
  /** The sources the facts are read from, read once. */
  files: Record<string, string>
  page: string
  rendered: string
  /** Every page the site serves, read as the file `deploy-website.yml` uploads. */
  pages: Array<{ file: string; text: string }>
  /** The links across the top of every generated page. */
  nav: string[][]
}

/** The file the toolbar's file menu lives in. */
const TOOLBAR = 'src/renderer/src/components/layout/Toolbar.tsx'
/** The file the Settings item's label is declared in. */
const FILE_MENU = 'src/shared/fileMenu.ts'
/** The file the settings dialog's tabs are declared in. */
const SETTINGS_DIALOG = 'src/renderer/src/components/layout/SettingsDialog.tsx'
/** The panel a key is entered in, where the field, the button and the two sentences live. */
const LICENSE_SECTION = 'src/renderer/src/components/license/LicenseSection.tsx'
/** The rule the last day of a key is decided by. */
const KEY_RULE = 'src/main/license/key.ts'
/** The seller-facing prose these pages stand in front of. */
const README = 'README.md'
/** The issuer behind `npm run license:issue`, which refuses to mint a key without a name. */
const KEYGEN = 'scripts/license-keygen.ts'

/** The file's own line wrapping read as one space: a sentence wrapped across two lines is one sentence. */
const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim()

/**
 * The file's text with its own line wrapping taken out — a sentence a comment or a markdown
 * paragraph wraps across two lines reads as the one sentence it is, and a JSDoc's `*` prefixes
 * go with the breaks — so a phrase is read as the reader of the app or the README reads it.
 */
const unwrapped = (source: string): string => source.replace(/\n\s*\*\s?/g, ' ')

/** The first capture group of a pattern, read against the file with its wrapping taken out. */
const group = (pattern: RegExp): Reader => source => {
  const found = pattern.exec(unwrapped(source))
  return found === null ? undefined : oneLine(found[1])
}

/** The matched words themselves, read against the file with its wrapping taken out. */
const words = (pattern: RegExp): Reader => source => {
  const found = pattern.exec(unwrapped(source))
  return found === null ? undefined : oneLine(found[0])
}

/**
 * The facts the page states, in the order it states them: the app's own strings first, then
 * what the record and the README decide. Each carries the file it is read from, so a failure
 * names the line of the app, the record or the README that moved rather than the page that
 * followed it.
 */
const FACTS: Fact[] = [
  {
    what: "the toolbar's file-menu button",
    file: TOOLBAR,
    read: group(/className="toolbar-brand"[\s\S]*?<\/svg>\s*([^<]+?)\s*<span/),
    stated: APP.menu,
    hold: 'exactly'
  },
  {
    what: 'the caret the toolbar draws beside that button',
    file: TOOLBAR,
    read: group(/<span className="toolbar-brand-caret">([^<]+)<\/span>/),
    stated: APP.caret,
    hold: 'exactly'
  },
  {
    what: 'the Settings… menu item',
    file: FILE_MENU,
    read: group(/\{\s*action:\s*'settings',\s*label:\s*'([^']+)'/),
    stated: APP.settings,
    hold: 'exactly'
  },
  {
    what: 'the License tab',
    file: SETTINGS_DIALOG,
    read: group(/\{\s*id:\s*'license',\s*label:\s*'([^']+)'/),
    stated: APP.tab,
    hold: 'exactly'
  },
  {
    what: "the key field's placeholder",
    file: LICENSE_SECTION,
    read: group(/placeholder="([^"]+)"/),
    stated: APP.field,
    hold: 'exactly'
  },
  {
    what: 'the button that enters the key',
    file: LICENSE_SECTION,
    read: group(/onClick=\{activate\}[\s\S]*?>\s*([^<]+?)\s*<\/button>/),
    stated: APP.activate,
    hold: 'exactly'
  },
  {
    what: 'the sentence under the key field',
    file: LICENSE_SECTION,
    read: words(/Checked on this machine[^<]*/),
    stated: APP.offline,
    hold: 'exactly'
  },
  {
    what: "the app's sentence for an ended key",
    file: LICENSE_SECTION,
    read: words(/The Pro half is off until a renewed key is entered;[^<]*/),
    stated: APP.ended,
    hold: 'exactly'
  },
  {
    what: 'the day a key is good through',
    file: KEY_RULE,
    read: words(/good for the whole of its last day, in UTC/),
    stated: END_OF_KEY[0],
    hold: 'within'
  },
  {
    what: 'what a lapsed trial is',
    file: README,
    read: words(/A trial is a key that lapses/),
    stated: END_OF_KEY[0],
    hold: 'within'
  },
  {
    what: 'what a lapsed key leaves',
    file: README,
    read: words(/with the show file untouched/),
    stated: END_OF_KEY[1],
    hold: 'within'
  },
  {
    what: 'what a renewed key restores',
    file: README,
    read: words(/without a restart/),
    stated: END_OF_KEY[2],
    hold: 'within'
  },
  {
    what: 'that nothing is sent anywhere',
    file: README,
    read: words(/Nothing is sent anywhere/),
    stated: ACTIVATION_STEPS[2],
    hold: 'within'
  },
  {
    what: 'that the key is entered once',
    file: README,
    read: words(/Enter it once/),
    stated: ENTRY_NOTE,
    hold: 'within'
  }
]

/**
 * A fact the page and its source each state in their own words, held by a pattern on both
 * sides. The README's fulfilment sequence says "Mint the key" and "Deliver it by email" where
 * the page says a person mints the key and it comes back by email: the two cannot be held to
 * one phrase, so they are held to one meaning — the source by a pattern read inside its own
 * section, the page by a pattern read inside the sentence it declares.
 */
interface PairFact {
  what: string
  file: string
  /** Whether the source says it, as a pattern read inside that file. */
  said: (source: string) => boolean
  /** The sentence the module renders for it. */
  stated: string
  /** Whether that sentence says it. */
  page: (stated: string) => boolean
}

/** The README's fulfilment sequence, which is the seller's own account of how a key reaches a buyer. */
function fulfilment(source: string, pattern: RegExp): boolean {
  const section = /### Fulfilling an order([\s\S]*?)\n## /.exec(source)
  return section !== null && pattern.test(section[1])
}

/**
 * The two halves of how a key arrives, each read against the README's own sequence and against
 * the page's own sentence — so a page that promises a checkout, an in-app trial or an instant
 * unlock fails by name, and a README that stops describing the hand-mint fails too.
 */
const PAIRS: PairFact[] = [
  {
    what: 'that a person mints the key',
    file: README,
    said: source => fulfilment(source, /\bMint the key\b/),
    stated: KEY_DELIVERY,
    page: stated => /\bmints? the key\b/i.test(stated)
  },
  {
    what: 'that the key arrives by email',
    file: README,
    said: source => fulfilment(source, /\bDeliver it by email\b/),
    stated: KEY_DELIVERY,
    page: stated => /\bby email\b/i.test(stated)
  },
  {
    what: 'that the trial runs from the day the key is minted',
    file: README,
    said: source => fulfilment(source, /minted with `--expires`/),
    stated: TRIAL_STARTS,
    page: stated => /\bfrom the day the key is minted\b/i.test(stated)
  },
  {
    what: 'that the key is issued to a name',
    file: KEYGEN,
    said: source => /A license needs a name/.test(unwrapped(source)),
    stated: KEY_NAME,
    page: stated => /\bname\b[^.]{0,40}\bissued to\b/i.test(stated)
  }
]

/**
 * The text of one source file, or a failure. A fact the page states in another file's words
 * cannot be checked against a file that cannot be read, so an unreadable source is loud: the
 * page would otherwise pass a run that holds it to nothing.
 */
function readSource(relative: string): string {
  try {
    return fs.readFileSync(path.join(root, relative), 'utf-8')
  } catch (cause) {
    throw new Error(
      `the trial page states facts out of ${relative}, which cannot be read — ${(cause as Error).message}`
    )
  }
}

/** Every source the facts and the pairs are named from, read once, each file under the name the failures use. */
function sources(): Record<string, string> {
  const files: Record<string, string> = {}
  for (const file of [...FACTS.map(fact => fact.file), ...PAIRS.map(pair => pair.file)]) {
    if (files[file] === undefined) files[file] = readSource(file)
  }
  return files
}

/** Where the market record lives: the input of the length and term checks. */
const recordPath = path.join(root, '_bmad-output', 'specs', 'spec-cuerunner', 'market-and-business.md')

/**
 * The README's trial-request paragraph, or a failure: it is the seller's own account of a
 * request, and the guard reads the two values it works a trial with — the length the key is
 * minted for and the address the request arrives at — out of it.
 */
function trialRequest(source: string): string {
  const paragraph = /A trial request is the same three steps[\s\S]*?\n\n/.exec(source)
  if (paragraph === null) {
    throw new Error(
      `${README} no longer carries the trial-request paragraph ("A trial request is the same three steps"): the seller's account of a request and the page's promises have to agree, so a README without it must not pass`
    )
  }
  return paragraph[0]
}

/**
 * The record as text, or a failure. The trial's length and terms have no other authority, and a
 * reading that came back empty would let any length through, so a record that cannot be opened
 * is loud.
 */
function readRecord(at: string = recordPath): string {
  try {
    return fs.readFileSync(at, 'utf-8')
  } catch (error) {
    throw new Error(
      `the market record could not be read at ${at} (${error instanceof Error ? error.message : String(error)}): the trial page's length and terms are read from its adopted model, so a run that cannot open it must not pass`
    )
  }
}

/**
 * The bullets under the record's adopted model, in file order — never an empty list. The
 * heading is the record's own, and a bullet that wrapped is joined back together, so a renamed
 * heading stops the run rather than reading as a model with nothing left in it.
 */
function adoptedModel(markdown: string): string[] {
  const lines = markdown.split('\n')
  const start = lines.findIndex(line => line.trim() === '## Adopted model (decision D2)')
  if (start === -1) {
    throw new Error(
      "the market record carries no '## Adopted model (decision D2)' section: the trial's length and terms are read from its bullets, so a section this guard cannot find is not a model with nothing to say"
    )
  }
  const bullets: string[] = []
  for (let line = start + 1; line < lines.length; line++) {
    if (lines[line].startsWith('## ')) break
    const text = lines[line].trim()
    if (text.startsWith('- ')) {
      bullets.push(text.slice(2).trim())
    } else if (text !== '' && bullets.length > 0) {
      bullets[bullets.length - 1] += ` ${text}`
    }
  }
  if (bullets.length === 0) {
    throw new Error(
      "the record's adopted model carries no bullets: the trial's length and terms are read from them, so an empty section is a failure rather than a model with nothing in it"
    )
  }
  return bullets
}

/** Every page the site serves, as `deploy-website.yml` uploads them: the tree as it stands. */
function servedPages(): Array<{ file: string; text: string }> {
  let entries: string[]
  try {
    entries = fs.readdirSync(path.join(root, 'website'), { recursive: true, encoding: 'utf-8' })
  } catch (cause) {
    throw new Error(`the trial page's nav check: website/ cannot be walked — ${(cause as Error).message}`)
  }
  const pages = entries.map(entry => entry.split(path.sep).join('/')).filter(entry => entry.endsWith('.html')).sort()
  if (pages.length === 0) {
    throw new Error("the trial page's nav check: website/ holds no page to read, so a pass here would mean nothing")
  }
  return pages.map(file => {
    try {
      return { file, text: fs.readFileSync(path.join(root, 'website', file), 'utf-8') }
    } catch (cause) {
      throw new Error(`the trial page's nav check: website/${file} cannot be read — ${(cause as Error).message}`)
    }
  })
}

/** The page this guard reads, found by its own path rather than by where it sits in the list. */
const TRIAL_PAGE = TRIAL.find((page: { path: string }) => page.path === 'trial.html')
if (TRIAL_PAGE === undefined) {
  throw new Error('website/docs/trial.mjs no longer declares trial.html: this guard reads the buyer page by its path')
}

/** The page as the repository holds it, the record as the record states it. */
const LIVE: Reading = {
  days: TRIAL_LENGTH,
  terms: TRIAL_TERMS,
  facts: FACTS,
  pairs: PAIRS,
  declared: [...ACTIVATION_STEPS, ...END_OF_KEY, KEY_DELIVERY, ENTRY_NOTE, TRIAL_STARTS, KEY_NAME, APP.offline, APP.ended],
  address: ORDER_EMAIL,
  reply: REPLY_WITHIN,
  bullets: adoptedModel(readRecord()).map(bullet => bullet.replace(/\*\*/g, '')),
  request: trialRequest(readSource(README)),
  files: sources(),
  page: 'trial.html',
  rendered: renderPage(TRIAL_PAGE),
  pages: servedPages(),
  nav: NAV
}

/**
 * The page's facts, each held to its source. A source that no longer says what the page states
 * fails naming the source; a page that copies the app's words when the app has moved on fails
 * naming both strings; and where the page says it in a sentence of its own, the sentence has to
 * carry the words the source uses for it.
 */
function factProblems(reading: Reading): string[] {
  return reading.facts.flatMap(fact => {
    const source = reading.files[fact.file]
    if (source === undefined) {
      return [`the page states ${fact.what}, read from ${fact.file}, and the guard has no reading of that file`]
    }
    const said = fact.read(source)
    if (said === undefined) {
      return [
        `${fact.file} no longer carries ${fact.what}: the trial page states it, so the file a reader meets it in has to say it ("website/docs/trial.mjs" and ${fact.file} have to agree)`
      ]
    }
    if (fact.hold === 'exactly') {
      return said === fact.stated
        ? []
        : [
            `website/docs/trial.mjs states "${fact.stated}" for ${fact.what}, and ${fact.file} says "${said}": the page renders the app's own words`
          ]
    }
    return fact.stated.toLowerCase().includes(said.toLowerCase())
      ? []
      : [
          `website/docs/trial.mjs states "${fact.stated}" for ${fact.what} without the words its source uses for it ("${said}")`
        ]
  })
}

/**
 * The facts the page and its source state in different words. The source has to say it — read
 * inside the section the fact belongs to, so a README that stops describing the hand-mint fails
 * — and the sentence the module declares for it has to say it too, so the page cannot promise a
 * checkout, an in-app trial or an instant unlock instead.
 */
function pairProblems(reading: Reading): string[] {
  return reading.pairs.flatMap(pair => {
    const source = reading.files[pair.file]
    if (source === undefined) {
      return [`the page states ${pair.what}, read from ${pair.file}, and the guard has no reading of that file`]
    }
    const problems: string[] = []
    if (!pair.said(source)) {
      problems.push(`${pair.file} no longer states ${pair.what}: the page tells a buyer it, so the seller's own account has to say it`)
    }
    if (!pair.page(pair.stated)) {
      problems.push(`website/docs/trial.mjs states "${pair.stated}" for ${pair.what} without saying it`)
    }
    return problems
  })
}

/** The sentences and labels the module declares, held to the page: a declaration nothing renders is a page and a declaration that disagree. */
function renderedProblems(reading: Reading): string[] {
  return reading.declared
    .filter(text => !reading.rendered.includes(text))
    .map(text => `the rendered page does not carry "${text}", which website/docs/trial.mjs declares and renders`)
}

/**
 * The seller's own account of a trial request, held to the two values the page publishes: the
 * README's paragraph states the length the key is minted for and the address the request
 * arrives at, and both are read out of it and held to the declarations — so a README that ages
 * into "30 days out", or that sends a buyer to an address the page never names, fails here
 * rather than in a mailbox nobody is watching.
 */
function requestProblems(reading: Reading): string[] {
  const problems: string[] = []
  const length = /(\d+) days out/.exec(reading.request)?.[1]
  if (length === undefined) {
    problems.push(
      `the README's trial-request paragraph states no length: the key is minted with \`--expires\` set from it, so the paragraph and the page have to say the same one`
    )
  } else if (Number(length) !== reading.days) {
    problems.push(`the README mints a trial ${length} days out and the record sets ${reading.days}`)
  }
  const addresses = [...reading.request.matchAll(ADDRESS)].map(match => match[0])
  if (addresses.length === 0) {
    problems.push(
      `the README's trial-request paragraph names no address: a request goes somewhere, and the paragraph has to name where`
    )
  }
  for (const address of [...new Set(addresses)]) {
    if (address.toLowerCase() !== reading.address.toLowerCase()) {
      problems.push(
        `the README's trial-request paragraph names the address ${address}, and the one the shop front declares is ${reading.address}`
      )
    }
  }
  return problems
}

/**
 * The length and the terms, held to the record's trial bullet. The record sets them in one
 * bullet and the page states them in its own sentences, so both directions are read: a bullet
 * that stops carrying the trial, a length that moves, and a term the page drops each fail by
 * name.
 */
function trialProblems(reading: Reading): string[] {
  const bullets = reading.bullets.filter(bullet => /\btrial\b/i.test(bullet))
  if (bullets.length !== 1) {
    return [
      bullets.length === 0
        ? "the record's adopted model carries no bullet stating a trial: the page's length and terms are read from it, so a model that no longer has one fails here rather than shipping a page with nothing behind it"
        : `the record's adopted model states a trial in ${bullets.length} bullets: the page's length and terms are read from the one bullet that decides them`
    ]
  }
  const bullet = bullets[0]
  const problems: string[] = []
  const length = /(\d+)-day/.exec(bullet)?.[1]
  if (length === undefined) {
    problems.push(
      `the record's trial bullet states no length ("${bullet}"): the page states one, so the record is where it comes from`
    )
  } else if (Number(length) !== reading.days) {
    problems.push(`the record sets a ${length}-day trial and the page declares ${reading.days} days`)
  }
  if (!new RegExp(`\\b${reading.days}[- ]days\\b`).test(reading.rendered)) {
    problems.push(`the rendered page does not state the trial's length (${reading.days} days)`)
  }
  for (const term of reading.terms) {
    if (!bullet.toLowerCase().includes(term.toLowerCase())) {
      problems.push(`the record's trial bullet no longer states "${term}": the page states it, so the record is where it comes from`)
    }
    if (!reading.rendered.toLowerCase().includes(term.toLowerCase())) {
      problems.push(`the trial page does not state "${term}", which the record's trial bullet sets`)
    }
  }
  return problems
}

/**
 * A value typed as a placeholder rather than supplied: the shapes a value takes when the
 * sentence around it was written first, including the reserved names a documentation example
 * uses. Refused by name so a page cannot ship a route that does not exist.
 */
const PLACEHOLDER =
  /\b(?:placeholder|todo|tbd|fixme|changeme|example|foo|bar|yoursite|xxx|your-(?:store|link|domain|address|site))\b|\.(?:test|invalid)\b/i

/** A reply time a sentence can promise: the phrase the pages write after "within". */
const REPLY_TIME = /^(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d+)(?: business)? (?:hour|day|week|month)s?$/i

/** Everything the page's promises are held to: the address and the reply the shop front declares once. */
function promiseProblems(reading: Reading): string[] {
  const problems: string[] = []
  if (reading.address.trim() === '') {
    problems.push(
      'website/docs/contact.mjs declares no value for ORDER_EMAIL (the one address): fill it with the inbox that answers — while it is empty the trial page offers no way to ask for a key'
    )
  } else if (PLACEHOLDER.test(reading.address)) {
    problems.push(`ORDER_EMAIL reads "${reading.address}", which is a placeholder rather than one live address`)
  } else if (/[<>"]/.test(reading.address)) {
    problems.push(`ORDER_EMAIL reads "${reading.address}", which carries markup: the address is rendered into the page's markup`)
  } else if (!/^\S+@\S+\.\S+$/.test(reading.address)) {
    problems.push(`ORDER_EMAIL reads "${reading.address}", which is not one email address`)
  }
  if (reading.reply.trim() === '') {
    problems.push(
      'website/docs/contact.mjs declares no value for REPLY_WITHIN (the reply the seller commits to): fill it with the turnaround the seller will keep — while it is empty the page promises nothing'
    )
  } else if (PLACEHOLDER.test(reading.reply)) {
    problems.push(`REPLY_WITHIN reads "${reading.reply}", which is a placeholder rather than a reply time`)
  } else if (/[<>"]/.test(reading.reply)) {
    problems.push(`REPLY_WITHIN reads "${reading.reply}", which carries markup: the reply is rendered into the page's prose`)
  } else if (!REPLY_TIME.test(reading.reply)) {
    problems.push(`REPLY_WITHIN reads "${reading.reply}", which is not a reply time a sentence can promise (the shape is "one business day")`)
  }
  return problems
}

/** The rendered page with the markup's entities put back, so a route is read as a reader reads it. */
function decoded(html: string): string {
  return html.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
}

/** An address as the page carries it, in words or behind a mailto. */
const ADDRESS = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g

/** A turnaround a sentence promises: the phrase after "within". */
const TURNAROUND = /\bwithin\s+((?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)(?:\s+business)?\s+(?:hour|day|week|month)s?)/gi

/**
 * What the rendered page promises, held to the two declarations. The address is the only
 * address on the page and the only place a mailto leads; the reply is the only turnaround any
 * sentence on it promises, and it is promised. A second address, a reply the seller never made,
 * or a page that names an address and never says how long an answer takes, each fails by name.
 */
function renderedPromiseProblems(reading: Reading): string[] {
  const rendered = decoded(reading.rendered)
  const problems: string[] = []
  const addresses = [...rendered.matchAll(ADDRESS)].map(match => match[0])
  for (const address of [...new Set(addresses)]) {
    if (address.toLowerCase() !== reading.address.toLowerCase()) {
      problems.push(
        `the rendered page names the address ${address}, and the only one the trial page may name is the address the shop front declares (${reading.address})`
      )
    }
  }
  const mailtos = [...rendered.matchAll(/href="(mailto:[^"]*)"/gi)].map(match => mailAddress(match[1]))
  if (!mailtos.some(address => address.toLowerCase() === reading.address.toLowerCase())) {
    problems.push(
      `the rendered page carries no mailto link to the address the trial page declares (${reading.address}): a request needs somewhere to go`
    )
  }
  const turnarounds = [...rendered.matchAll(TURNAROUND)].map(match => oneLine(match[1]))
  for (const phrase of [...new Set(turnarounds)]) {
    if (phrase.toLowerCase() !== reading.reply.toLowerCase()) {
      problems.push(`the rendered page promises "${phrase}", and the reply the seller commits to is "${reading.reply}"`)
    }
  }
  if (!turnarounds.some(phrase => phrase.toLowerCase() === reading.reply.toLowerCase())) {
    problems.push(
      `the rendered page does not state the reply the seller commits to ("${reading.reply}"): a page that names an address has to say how long an answer takes`
    )
  }
  return problems
}

/**
 * Every link the rendered page carries, held to something that exists: a relative href has to
 * resolve to a file the site serves, and the only route off the site is the declared address.
 * A typo'd href, a link to a page nothing generates, and a second channel dressed as a link are
 * all failures by name — the check a reader makes by clicking, made on every run.
 */
/** The address behind a mailto, with the query and the fragment a prefilled message may carry taken off. */
function mailAddress(href: string): string {
  return href.slice('mailto:'.length).split('?')[0].split('#')[0]
}

/**
 * Where a relative href points on disk: a leading `/` is the site's own root, which
 * `deploy-website.yml` uploads as `website/`, and anything else is relative to the page. A
 * host-root path is not a file on the machine the guard runs on, so it is read as the site's.
 */
function resolveLink(reading: Reading, href: string): string {
  const target = href.split('#')[0].split('?')[0]
  return target.startsWith('/')
    ? path.join(root, 'website', target)
    : path.resolve(path.dirname(path.join(root, 'website', reading.page)), target)
}

/**
 * Every link the rendered page carries, held to something that exists: a relative href — the
 * site's own root included — has to resolve to a file the site serves, and the only route off
 * the site is the declared address, however a mailto is dressed. A typo'd href, a link to a
 * page nothing generates, and a second channel are all failures by name — the check a reader
 * makes by clicking, made on every run.
 */
function deadLinkProblems(reading: Reading): string[] {
  return [...decoded(reading.rendered).matchAll(/href="([^"]*)"/g)].flatMap(match => {
    const href = match[1]
    if (href.startsWith('#')) return []
    if (href.toLowerCase().startsWith('mailto:')) {
      return mailAddress(href).toLowerCase() === reading.address.toLowerCase()
        ? []
        : [
            `the rendered page carries the link ${href}: the trial page's only route off the site is the address it declares (${reading.address})`
          ]
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(href)) {
      return [
        `the rendered page carries the link ${href}: the trial page offers no channel that is not the address it declares, so a link off the site is not one it can offer`
      ]
    }
    return fs.existsSync(resolveLink(reading, href))
      ? []
      : [`the rendered page links to ${href}, which the site does not hold: a link a reader can click has to resolve`]
  })
}

/** The primary nav of a page, as the markup that carries it — a page without one fails loudly rather than skipping. */
function primaryNav(file: string, html: string): string {
  const nav = /<nav class="top-nav"[^>]*>([\s\S]*?)<\/nav>/.exec(html)
  if (nav === null) {
    throw new Error(
      `the trial page's nav check: website/${file} carries no <nav class="top-nav">, so the nav it serves cannot be read`
    )
  }
  return nav[1]
}

/** The trial page's link, as the nav carries it from the root and from a page a directory down. */
const TRIAL_LINK = /<a href="(?:\.\/|\.\.\/)?trial\.html"[^>]*>Trial<\/a>/

/**
 * The pages whose primary nav does not carry the trial page's link, and the NAV list behind
 * them. A nav that offers the page on some pages and not on others is the trial half-published,
 * so every page the site serves is read — the generated ones through the list the renderer used,
 * the hand-written ones as the files they are.
 */
function navProblems(reading: Reading): string[] {
  const problems: string[] = []
  if (!reading.pages.some(page => page.file === 'trial.html')) {
    problems.push('website/trial.html is not among the pages the site serves: the nav links to a page a buyer cannot open')
  }
  if (!reading.nav.some(([href, label]) => href === 'trial.html' && label === 'Trial')) {
    problems.push(
      "website/build-docs.mjs's NAV carries no ['trial.html', 'Trial'] entry, so no page the docs build writes can reach the trial page"
    )
  }
  return problems.concat(
    reading.pages
      .filter(page => !TRIAL_LINK.test(primaryNav(page.file, page.text)))
      .map(
        page =>
          `website/${page.file}'s primary nav carries no link to website/trial.html: the trial page must be one of the links on every page the site serves`
      )
  )
}

describe('the trial page', () => {
  it('states each of its facts in the words its source uses for them', () => {
    expect(factProblems(LIVE)).toEqual([])
  })

  it('states how a key arrives in the words the fulfilment sequence uses for it', () => {
    expect(pairProblems(LIVE)).toEqual([])
  })

  it('renders every sentence and label the module declares', () => {
    expect(renderedProblems(LIVE)).toEqual([])
  })

  it('states the length and the terms the record sets for the trial', () => {
    expect(trialProblems(LIVE)).toEqual([])
  })

  it('works a request for the length and the address the page publishes', () => {
    expect(requestProblems(LIVE)).toEqual([])
  })

  it('declares the address and the reply as live values', () => {
    expect(promiseProblems(LIVE)).toEqual([])
  })

  it('names the declared address and no other, and the declared reply as the only turnaround', () => {
    expect(renderedPromiseProblems(LIVE)).toEqual([])
  })

  it('links nothing a reader cannot open', () => {
    expect(deadLinkProblems(LIVE)).toEqual([])
  })

  it('is one of the links on every page the site serves', () => {
    expect(navProblems(LIVE)).toEqual([])
  })
})

/**
 * The page the repository would never commit, one failure at a time: each case changes one
 * thing in the live reading and asserts the check names it. These are the states the checks
 * exist to refuse — a label the app has moved, a sentence the page drops, a length that drifts,
 * a term the record has stopped setting, a second address, a turnaround nobody agreed to, a
 * link that goes nowhere, a nav that loses the page — and nothing else in the suite exercises
 * them.
 */
describe('the page the checks exist to refuse', () => {
  /** The live reading with one fact's declared words or one source's text replaced. */
  function withFact(reading: Reading, what: string, change: Partial<Fact>): Reading {
    return { ...reading, facts: reading.facts.map(fact => (fact.what === what ? { ...fact, ...change } : fact)) }
  }

  /** The live reading with one source file's text replaced. */
  function withSource(reading: Reading, file: string, text: string): Reading {
    return { ...reading, files: { ...reading.files, [file]: text } }
  }

  /** The live reading with the record's trial bullet replaced. */
  function withTrialBullet(reading: Reading, bullet: string): Reading {
    return {
      ...reading,
      bullets: reading.bullets.map(candidate => (/\btrial\b/i.test(candidate) ? bullet : candidate))
    }
  }

  it('names the source that has stopped saying what the page states', () => {
    const moved = withSource(LIVE, FILE_MENU, "const FILE_MENU: FileMenuEntry[] = [\n  { action: 'save', label: 'Save' }\n]")
    expect(factProblems(moved)).toEqual([
      expect.stringContaining('src/shared/fileMenu.ts no longer carries the Settings… menu item')
    ])
  })

  it('names the app label the page copies when the app has moved on', () => {
    const renamed = withFact(LIVE, 'the License tab', { stated: 'Licence' })
    expect(factProblems(renamed)).toEqual([
      expect.stringContaining('website/docs/trial.mjs states "Licence" for the License tab, and src/renderer/src/components/layout/SettingsDialog.tsx says "License"')
    ])
  })

  it('names the page sentence that loses the words its source states it in', () => {
    const reworded = withFact(LIVE, 'what a lapsed key leaves', { stated: 'Nothing is lost when the trial ends.' })
    expect(factProblems(reworded)).toEqual([
      expect.stringContaining(
        'website/docs/trial.mjs states "Nothing is lost when the trial ends." for what a lapsed key leaves without the words its source uses for it ("with the show file untouched")'
      )
    ])
  })

  it('names a page that promises a checkout instead of a person minting the key', () => {
    const checkout = {
      ...LIVE,
      pairs: LIVE.pairs.map(pair =>
        pair.what === 'that a person mints the key' ? { ...pair, stated: 'Buy a trial key in the app.' } : pair
      )
    }
    expect(pairProblems(checkout)).toEqual([
      expect.stringContaining('website/docs/trial.mjs states "Buy a trial key in the app." for that a person mints the key without saying it')
    ])
  })

  it('names a fulfilment sequence the README has stopped describing', () => {
    const without = withSource(LIVE, README, '## Cuerunner Pro\n\nNothing here about orders.\n\n## Support\n')
    expect(pairProblems(without)).toEqual([
      expect.stringContaining('README.md no longer states that a person mints the key'),
      expect.stringContaining('README.md no longer states that the key arrives by email'),
      expect.stringContaining('README.md no longer states that the trial runs from the day the key is minted')
    ])
  })

  it('names a page that states the length and never says when it starts', () => {
    const undated = { ...LIVE, rendered: LIVE.rendered.replace(TRIAL_STARTS, '') }
    expect(renderedProblems(undated)).toEqual([
      expect.stringContaining(`the rendered page does not carry "${TRIAL_STARTS}"`)
    ])
    const vague = { ...LIVE, pairs: LIVE.pairs.map(pair => (pair.what === 'that the trial runs from the day the key is minted' ? { ...pair, stated: 'The trial starts when you first open the app.' } : pair)) }
    expect(pairProblems(vague)).toEqual([
      expect.stringContaining('website/docs/trial.mjs states "The trial starts when you first open the app." for that the trial runs from the day the key is minted without saying it')
    ])
  })

  it('names a page that asks for a request without the name the key is issued to', () => {
    const anonymous = { ...LIVE, rendered: LIVE.rendered.replace(KEY_NAME, '') }
    expect(renderedProblems(anonymous)).toEqual([
      expect.stringContaining(`the rendered page does not carry "${KEY_NAME}"`)
    ])
    const silent = { ...LIVE, pairs: LIVE.pairs.map(pair => (pair.what === 'that the key is issued to a name' ? { ...pair, stated: 'Tell us what you run.' } : pair)) }
    expect(pairProblems(silent)).toEqual([
      expect.stringContaining('website/docs/trial.mjs states "Tell us what you run." for that the key is issued to a name without saying it')
    ])
    const loose = withSource(LIVE, KEYGEN, "throw new Error('--name is empty')\\n")
    expect(pairProblems(loose)).toEqual([
      expect.stringContaining('scripts/license-keygen.ts no longer states that the key is issued to a name')
    ])
  })

  it('names a README trial paragraph that mints a different length', () => {
    const stale = { ...LIVE, request: LIVE.request.replace('14 days out', '30 days out') }
    expect(requestProblems(stale)).toEqual([
      expect.stringContaining('the README mints a trial 30 days out and the record sets 14')
    ])
  })

  it('names a README trial paragraph without a length at all', () => {
    const vague = { ...LIVE, request: LIVE.request.replace('14 days out', 'for a while') }
    expect(requestProblems(vague)).toEqual([
      expect.stringContaining("the README's trial-request paragraph states no length")
    ])
  })

  it('names a README trial paragraph that sends a request to another address', () => {
    const moved = { ...LIVE, request: LIVE.request.replace('orders@cuerunner.app', 'hello@cuerunner.app') }
    expect(requestProblems(moved)).toEqual([
      expect.stringContaining("the README's trial-request paragraph names the address hello@cuerunner.app, and the one the shop front declares is orders@cuerunner.app")
    ])
    const addressless = { ...LIVE, request: LIVE.request.replace('`orders@cuerunner.app`, the address the', 'the address the') }
    expect(requestProblems(addressless)).toEqual([
      expect.stringContaining("the README's trial-request paragraph names no address")
    ])
  })

  it('names a sentence the rendered page does not carry', () => {
    const dropped = { ...LIVE, rendered: LIVE.rendered.replace(ENTRY_NOTE, '') }
    expect(renderedProblems(dropped)).toEqual([
      expect.stringContaining(`the rendered page does not carry "${ENTRY_NOTE}"`)
    ])
  })

  it('names a step the rendered page does not carry', () => {
    const dropped = { ...LIVE, rendered: LIVE.rendered.replace(ACTIVATION_STEPS[0], '') }
    expect(renderedProblems(dropped)).toEqual([
      expect.stringContaining(`the rendered page does not carry "${ACTIVATION_STEPS[0]}"`)
    ])
  })

  it('names a record that has stopped stating a trial', () => {
    const without = { ...LIVE, bullets: LIVE.bullets.filter(bullet => !/\btrial\b/i.test(bullet)) }
    expect(trialProblems(without)).toEqual([
      expect.stringContaining("the record's adopted model carries no bullet stating a trial")
    ])
  })

  it('names a record that states two trials, where the page reads one', () => {
    const twice = { ...LIVE, bullets: [...LIVE.bullets, '**30-day trial key** for the education pilot.'] }
    expect(trialProblems(twice)).toEqual([
      expect.stringContaining("the record's adopted model states a trial in 2 bullets")
    ])
  })

  it('names a trial bullet that states no length', () => {
    const lengthless = withTrialBullet(LIVE, '**free trial key**, full Pro, self-serve, offline.')
    expect(trialProblems(lengthless)).toEqual([
      expect.stringContaining("the record's trial bullet states no length")
    ])
  })

  it('names a length the record does not set', () => {
    expect(trialProblems({ ...LIVE, days: 30 })).toEqual([
      expect.stringContaining('the record sets a 14-day trial and the page declares 30 days'),
      expect.stringContaining("the rendered page does not state the trial's length (30 days)")
    ])
  })

  it('names a term the record has stopped setting', () => {
    const dropped = withTrialBullet(LIVE, '**14-day free trial key**, full Pro and offline.')
    expect(trialProblems(dropped)).toEqual([
      expect.stringContaining('the record\'s trial bullet no longer states "self-serve"')
    ])
  })

  it('names a term the rendered page has stopped stating', () => {
    const dropped = { ...LIVE, rendered: LIVE.rendered.replace('Self-serve.', 'On request.') }
    expect(trialProblems(dropped)).toEqual([
      expect.stringContaining('the trial page does not state "self-serve"')
    ])
  })

  it('names an address the seller has not supplied yet, and the fill that clears it', () => {
    const empty = { ...LIVE, address: '' }
    expect(promiseProblems(empty)).toEqual([
      expect.stringContaining('website/docs/contact.mjs declares no value for ORDER_EMAIL')
    ])
    expect(renderedPromiseProblems(empty)).toEqual([
      expect.stringContaining('the rendered page names the address orders@cuerunner.app'),
      expect.stringContaining('the rendered page carries no mailto link to the address the trial page declares')
    ])
  })

  it('names an address a placeholder was left in', () => {
    const placeholder = { ...LIVE, address: 'orders@example.com' }
    expect(promiseProblems(placeholder)).toEqual([
      expect.stringContaining('ORDER_EMAIL reads "orders@example.com", which is a placeholder')
    ])
  })

  it('names an address that carries markup', () => {
    const markup = { ...LIVE, address: 'orders@cuerunner.app<b>' }
    expect(promiseProblems(markup)).toEqual([
      expect.stringContaining('ORDER_EMAIL reads "orders@cuerunner.app<b>", which carries markup')
    ])
  })

  it('names an address that is not one', () => {
    const malformed = { ...LIVE, address: 'orders at cuerunner dot app' }
    expect(promiseProblems(malformed)).toEqual([
      expect.stringContaining('ORDER_EMAIL reads "orders at cuerunner dot app", which is not one email address')
    ])
  })

  it('names a reply the seller has not committed to, and the shape it has to have', () => {
    const empty = { ...LIVE, reply: '' }
    expect(promiseProblems(empty)).toEqual([
      expect.stringContaining('website/docs/contact.mjs declares no value for REPLY_WITHIN')
    ])
    const vague = { ...LIVE, reply: 'as soon as we can' }
    expect(promiseProblems(vague)).toEqual([
      expect.stringContaining('REPLY_WITHIN reads "as soon as we can", which is not a reply time a sentence can promise')
    ])
  })

  it('names a second address on the rendered page', () => {
    const copied = { ...LIVE, rendered: `${LIVE.rendered}\n<a href="mailto:support@cuerunner.app">support@cuerunner.app</a>` }
    expect(renderedPromiseProblems(copied)).toEqual([
      expect.stringContaining('the rendered page names the address support@cuerunner.app')
    ])
  })

  it('names a page that names an address and never says how long an answer takes', () => {
    const silent = { ...LIVE, rendered: LIVE.rendered.replace(`a request is answered within ${REPLY_WITHIN}.`, 'a request is answered.') }
    expect(renderedPromiseProblems(silent)).toEqual([
      expect.stringContaining('the rendered page does not state the reply the seller commits to ("one business day")')
    ])
  })

  it('names a turnaround the seller never made', () => {
    const invented = { ...LIVE, rendered: LIVE.rendered.replace(`within ${REPLY_WITHIN}`, 'within 48 hours') }
    expect(renderedPromiseProblems(invented)).toEqual([
      expect.stringContaining('the rendered page promises "48 hours", and the reply the seller commits to is "one business day"'),
      expect.stringContaining('the rendered page does not state the reply the seller commits to ("one business day")')
    ])
  })

  it('names a link a reader cannot open', () => {
    const dead = { ...LIVE, rendered: LIVE.rendered.replace('href="pro.html"', 'href="pro-features.html"') }
    expect(deadLinkProblems(dead)).toEqual([
      expect.stringContaining('the rendered page links to pro-features.html, which the site does not hold')
    ])
  })

  it('reads a link to the site root as the site it serves, and refuses one it does not hold', () => {
    const rooted = { ...LIVE, rendered: `${LIVE.rendered}\n<a href="/support.html">Support</a>` }
    expect(deadLinkProblems(rooted)).toEqual([])
    const missing = { ...LIVE, rendered: `${LIVE.rendered}\n<a href="/support-page.html">Support</a>` }
    expect(deadLinkProblems(missing)).toEqual([
      expect.stringContaining('the rendered page links to /support-page.html, which the site does not hold')
    ])
  })

  it('reads a mailto carrying a subject or a fragment as the address it is', () => {
    const prefilled = { ...LIVE, rendered: `${LIVE.rendered}\n<a href="mailto:${ORDER_EMAIL}?subject=Trial">Ask</a>` }
    expect(deadLinkProblems(prefilled)).toEqual([])
    expect(renderedPromiseProblems(prefilled)).toEqual([])
    const elsewhere = { ...LIVE, rendered: `${LIVE.rendered}\n<a href="mailto:help@cuerunner.app?subject=Trial">Ask</a>` }
    expect(deadLinkProblems(elsewhere)).toEqual([
      expect.stringContaining('the rendered page carries the link mailto:help@cuerunner.app?subject=Trial')
    ])
  })

  it('names a channel that is not the address the page declares', () => {
    const elsewhere = { ...LIVE, rendered: `${LIVE.rendered}\n<a href="https://github.com/Huckcity/cuerunner/issues">Ask on GitHub</a>` }
    expect(deadLinkProblems(elsewhere)).toEqual([
      expect.stringContaining('the rendered page carries the link https://github.com/Huckcity/cuerunner/issues')
    ])
  })

  it('names the hand-written page whose nav loses the trial page link', () => {
    const drifted = LIVE.pages.map(page =>
      page.file === 'reliability.html'
        ? { ...page, text: page.text.replace('        <a href="./trial.html">Trial</a>\n', '') }
        : page
    )
    expect(navProblems({ ...LIVE, pages: drifted })).toEqual([
      expect.stringContaining("website/reliability.html's primary nav carries no link to website/trial.html")
    ])
  })

  it('names the NAV list a generated page would lose the link from', () => {
    const without = LIVE.nav.filter(([href]) => href !== 'trial.html')
    expect(navProblems({ ...LIVE, nav: without })).toEqual([
      expect.stringContaining("NAV carries no ['trial.html', 'Trial'] entry")
    ])
  })

  it('names the site that serves no trial page at all', () => {
    const without = LIVE.pages.filter(page => page.file !== 'trial.html')
    expect(navProblems({ ...LIVE, pages: without })).toEqual([
      expect.stringContaining('website/trial.html is not among the pages the site serves')
    ])
  })
})

/**
 * The guard reads the app, the README and the market record, and a source it cannot read is a
 * failure rather than an empty pass: facts compared against nothing is the vacuous run the
 * sources exist to prevent.
 */
describe('the sources the guard reads', () => {
  it('fails loudly on a source file that cannot be read', () => {
    expect(() => readSource('src/main/license/moved.ts')).toThrow('which cannot be read')
  })

  it('fails loudly on a README that has stopped carrying the trial-request paragraph', () => {
    expect(() => trialRequest('# Cuerunner\n\nNo requests here.\n')).toThrow(
      'README.md no longer carries the trial-request paragraph'
    )
  })

  it('fails loudly when the record is not at the path it names', () => {
    expect(() => readRecord(`${recordPath}.moved`)).toThrow('the market record could not be read at')
  })

  it('fails loudly on a record whose adopted model is not there', () => {
    expect(() => adoptedModel('# nothing to read here')).toThrow(
      "carries no '## Adopted model (decision D2)' section"
    )
    expect(() => adoptedModel('## Adopted model (decision D2)\n\nthe model moved to another file\n')).toThrow(
      'carries no bullets'
    )
  })

  it('reads a fact out of a file that wraps it, and a fact that has moved as nothing', () => {
    expect(group(/\{\s*action:\s*'settings',\s*label:\s*'([^']+)'/)(readSource(FILE_MENU))).toBe('Settings…')
    expect(words(/good for the whole of its last day, in UTC/)(readSource(KEY_RULE))).toBe(
      'good for the whole of its last day, in UTC'
    )
    expect(group(/\{\s*id:\s*'license',\s*label:\s*'([^']+)'/)(readSource(FILE_MENU))).toBeUndefined()
  })
})
