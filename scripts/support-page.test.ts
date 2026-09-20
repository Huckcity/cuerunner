// The support page, held to the app it points at, the README rule it publishes and the one
// address it promises.
//
// `website/support.html` is the page institutional procurement reads before it buys — who
// answers, what is covered free and for Pro, and how a licence comes off a machine — and
// nothing read it: the deactivation wording could drift from the panel an operator actually
// sees, a refund sentence could grow a window the seller never agreed to, and a second address
// or a reply time nobody committed to could ship as a promise. The page's facts are
// declarations now (website/docs/support.mjs), so this guard can read each one against the file
// it comes from:
//
// - the app's own labels and sentence — the `Settings…` item, the `License` tab, the
//   `Deactivate` button and the note under it — read out of `src/shared/fileMenu.ts`,
//   `SettingsDialog.tsx` and `LicenseSection.tsx` as text, because a React component is not
//   something this guard can import;
// - the refund rule, read out of the README's "Refunds and deactivation" paragraph, which is
//   what the page publishes a route to: the row the key was sold under is marked refunded, and
//   the machine is deactivated.
//
// **What the reading covers.** Every fact is held both ways — the source must still say it, and
// the page must state it in the source's own words. The two coverage rows are the page's own
// statement of what support covers; the guard holds them to being two (one for the free app and
// one for Pro), to being whole and free of placeholders, and to being rendered, because "the
// free app is supported" and "a licence question is answered" are two different promises and a
// page owes a reader both. The promise checks are the same as the trial page's: the address is
// the only address on the page and the only place a mailto leads, the reply is the only
// turnaround any sentence on it promises and it is promised, every link resolves, the refund
// sentence carries the rule's two halves and no window or terms, and the primary nav of every
// page the site serves carries this one's link.
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
  COVERAGE,
  DEACTIVATE,
  DEACTIVATION,
  DEACTIVATION_PATH,
  LICENSE_TAB,
  REFUND_ROUTE,
  SETTINGS_ITEM,
  SUPPORT
} from '../website/docs/support.mjs'
// @ts-ignore — js file, no type declarations
import { TRIAL } from '../website/docs/trial.mjs'
// @ts-ignore — js file, no type declarations
import { ORDER_EMAIL, REPLY_WITHIN } from '../website/docs/contact.mjs'
// @ts-ignore — js file, no type declarations
import { NAV, renderPage } from '../website/build-docs.mjs'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

/** How a fact is read out of its source: the file's text in, the words it carries out. */
type Reader = (source: string) => string | undefined

/** One fact the page states in another file's words, which the guard reads out of that file. */
interface Fact {
  what: string
  file: string
  read: Reader
  stated: string
}

/** One row of coverage as the page declares it: the half of the app, and what is covered there. */
interface Coverage {
  who: string
  prose: string
}

/** Everything the checks read, in one value: a case below hands them a mutation of it. */
interface Reading {
  coverage: Coverage[]
  facts: Fact[]
  /** What the module declares and the page renders: the coverage rows, the deactivation note and the refund route. */
  declared: string[]
  address: string
  reply: string
  /** The refund route the page declares, and the README's rule, as the paragraph states it. */
  route: string
  rule: string
  /** The trial page as it is served: the second page a refund window could be published on. */
  trialRendered: string
  /** The sources the facts are read from, read once. */
  files: Record<string, string>
  page: string
  rendered: string
  /** Every page the site serves, read as the file `deploy-website.yml` uploads. */
  pages: Array<{ file: string; text: string }>
  /** The links across the top of every generated page. */
  nav: string[][]
}

/** The file the Settings item's label is declared in. */
const FILE_MENU = 'src/shared/fileMenu.ts'
/** The file the settings dialog's tabs are declared in. */
const SETTINGS_DIALOG = 'src/renderer/src/components/layout/SettingsDialog.tsx'
/** The panel a key is entered in, where the button and the note live. */
const LICENSE_SECTION = 'src/renderer/src/components/license/LicenseSection.tsx'
/** The seller-facing prose the refund route stands in front of. */
const README = 'README.md'

/**
 * The file's text with its own line wrapping taken out — a sentence a comment or a markdown
 * paragraph wraps across two lines reads as the one sentence it is, and a JSDoc's `*` prefixes
 * go with the breaks — so a phrase is read as the reader of the app or the README reads it.
 */
const unwrapped = (source: string): string => source.replace(/\n\s*\*\s?/g, ' ')

/** The first capture group of a pattern, read against the file with its wrapping taken out. */
const group = (pattern: RegExp): Reader => source => {
  const found = pattern.exec(unwrapped(source))
  return found === null ? undefined : found[1].replace(/\s+/g, ' ').trim()
}

/** The matched words themselves, read against the file with its wrapping taken out. */
const words = (pattern: RegExp): Reader => source => {
  const found = pattern.exec(unwrapped(source))
  return found === null ? undefined : found[0].replace(/\s+/g, ' ').trim()
}

/**
 * The facts the page states, in the order it states them: the app's own labels and its sentence
 * for deactivation, read out of the files the app carries them in. Each names the file it comes
 * from, so a failure points at the control that moved rather than at the page that followed it.
 */
const FACTS: Fact[] = [
  {
    what: 'the Settings… menu item',
    file: FILE_MENU,
    read: group(/\{\s*action:\s*'settings',\s*label:\s*'([^']+)'/),
    stated: SETTINGS_ITEM
  },
  {
    what: 'the License tab',
    file: SETTINGS_DIALOG,
    read: group(/\{\s*id:\s*'license',\s*label:\s*'([^']+)'/),
    stated: LICENSE_TAB
  },
  {
    what: 'the button that takes a key off a machine',
    file: LICENSE_SECTION,
    read: group(/onClick=\{deactivate\}[\s\S]*?>\s*([^<]+?)\s*<\/button>/),
    stated: DEACTIVATE
  },
  {
    what: 'the note that says what deactivating leaves',
    file: LICENSE_SECTION,
    read: words(/Deactivating puts this machine back to the free app[^<]*/),
    stated: DEACTIVATION
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
      `the support page states facts out of ${relative}, which cannot be read — ${(cause as Error).message}`
    )
  }
}

/** Every source the facts are named from, read once, each file under the name the failures use. */
function sources(): Record<string, string> {
  const files: Record<string, string> = {}
  for (const fact of FACTS) {
    if (files[fact.file] === undefined) files[fact.file] = readSource(fact.file)
  }
  return files
}

/**
 * The README's refund rule, as the sentence that states it — or a failure, because the page
 * publishes a route to this rule and a rule nobody can read is not one the page stands on.
 */
function refundRule(source: string): string {
  const rule = /A refund is the ledger row marked refunded plus a request to deactivate[^.]*\./.exec(source)
  if (rule === null) {
    throw new Error(
      `${README} no longer states the refund rule ("A refund is the ledger row marked refunded plus a request to deactivate"): the support page publishes the route to it, so a README without it leaves the page promising something no longer written down`
    )
  }
  return rule[0]
}

/** Every page the site serves, as `deploy-website.yml` uploads them: the tree as it stands. */
function servedPages(): Array<{ file: string; text: string }> {
  let entries: string[]
  try {
    entries = fs.readdirSync(path.join(root, 'website'), { recursive: true, encoding: 'utf-8' })
  } catch (cause) {
    throw new Error(`the support page's nav check: website/ cannot be walked — ${(cause as Error).message}`)
  }
  const pages = entries.map(entry => entry.split(path.sep).join('/')).filter(entry => entry.endsWith('.html')).sort()
  if (pages.length === 0) {
    throw new Error("the support page's nav check: website/ holds no page to read, so a pass here would mean nothing")
  }
  return pages.map(file => {
    try {
      return { file, text: fs.readFileSync(path.join(root, 'website', file), 'utf-8') }
    } catch (cause) {
      throw new Error(`the support page's nav check: website/${file} cannot be read — ${(cause as Error).message}`)
    }
  })
}

/** The page this guard reads, found by its own path rather than by where it sits in the list. */
const SUPPORT_PAGE = SUPPORT.find((page: { path: string }) => page.path === 'support.html')
if (SUPPORT_PAGE === undefined) {
  throw new Error('website/docs/support.mjs no longer declares support.html: this guard reads the buyer page by its path')
}

/**
 * The other page this promise is public on: the refund-window refusal is not the support page's
 * alone, because a trial page can grow one just as easily.
 */
const TRIAL_PAGE = TRIAL.find((page: { path: string }) => page.path === 'trial.html')
if (TRIAL_PAGE === undefined) {
  throw new Error('website/docs/trial.mjs no longer declares trial.html: the refund-window check reads the second page it covers')
}

/** The page as the repository holds it, the rule as the README states it. */
const LIVE: Reading = {
  coverage: COVERAGE,
  facts: FACTS,
  declared: [...COVERAGE.map((row: Coverage) => row.prose), DEACTIVATION_PATH, DEACTIVATION, REFUND_ROUTE],
  address: ORDER_EMAIL,
  reply: REPLY_WITHIN,
  route: REFUND_ROUTE,
  rule: refundRule(readSource(README)),
  trialRendered: renderPage(TRIAL_PAGE),
  files: sources(),
  page: 'support.html',
  rendered: renderPage(SUPPORT_PAGE),
  pages: servedPages(),
  nav: NAV
}

/**
 * The page's facts, each held to its source: a file that no longer says what the page states
 * fails naming the file, and a page that copies the app's words when the app has moved on fails
 * naming both strings.
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
        `${fact.file} no longer carries ${fact.what}: the support page states it, so the file a reader meets it in has to say it ("website/docs/support.mjs" and ${fact.file} have to agree)`
      ]
    }
    return said === fact.stated
      ? []
      : [
          `website/docs/support.mjs states "${fact.stated}" for ${fact.what}, and ${fact.file} says "${said}": the page renders the app's own words`
        ]
  })
}

/** The sentences and rows the module declares, held to the page: a declaration nothing renders is a page and a declaration that disagree. */
function renderedProblems(reading: Reading): string[] {
  return reading.declared
    .filter(text => !reading.rendered.includes(text))
    .map(text => `the rendered page does not carry "${text}", which website/docs/support.mjs declares and renders`)
}

/**
 * The two halves of coverage. A page that answers for the free app and not for Pro — or the
 * other way round — has promised half of what a buyer came for, and a row that is empty, a
 * placeholder or a label carrying markup is a row that says nothing a reader can hold. Every
 * row has to be rendered whole, so a row declared perfectly and shipped as something else fails
 * too.
 */
function coverageProblems(reading: Reading): string[] {
  const problems: string[] = []
  if (reading.coverage.length !== 2) {
    problems.push(
      `website/docs/support.mjs declares ${reading.coverage.length} coverage rows: the page owes a reader what is covered for the free app and what a licence covers, one row each`
    )
  }
  const halves: Array<{ half: string; pattern: RegExp }> = [
    { half: 'the free app', pattern: /\bfree\b/i },
    { half: 'Cuerunner Pro', pattern: /\bpro\b/i }
  ]
  for (const { half, pattern } of halves) {
    const rows = reading.coverage.filter(row => pattern.test(row.who))
    if (rows.length !== 1) {
      problems.push(
        `the page declares ${rows.length} coverage rows for ${half}: exactly one row has to say what is covered there`
      )
    }
  }
  for (const row of reading.coverage) {
    if (/[<>"]/.test(row.who)) {
      problems.push(`the page's coverage row "${row.who}" carries markup in the half of the app it names: a row is found by its label`)
      continue
    }
    if (row.prose.trim() === '') {
      problems.push(`the page's "${row.who}" row covers nothing: it states a label and no answer to what is covered there`)
    } else if (PLACEHOLDER.test(row.prose)) {
      problems.push(`the page's "${row.who}" row reads "${row.prose}", which is a placeholder rather than what is covered`)
    }
    if (!reading.rendered.includes(row.prose)) {
      problems.push(`the rendered page does not carry what the "${row.who}" row covers`)
    }
  }
  return problems
}

/**
 * The rule's two halves, as the README states them and as the page has to state them back. The
 * second is held to the request itself rather than to the word "deactivate": a page that says
 * the machine ends up deactivated has stated the outcome and dropped the buyer's half of it,
 * which is the half a reader has to do.
 */
const REFUND_HALVES: Array<{ half: string; rule: RegExp; route: RegExp }> = [
  { half: 'the row marked refunded', rule: /\brefunded\b/, route: /\brefunded\b/ },
  {
    half: 'the request to deactivate the machine',
    rule: /\brequest to deactivate\b/,
    route: /\b(?:request|ask\w*)\b[^.]{0,40}\bdeactivat/i
  }
]

/**
 * The README's refund rule and the page's refund sentence, held to each other. The rule has two
 * halves and the page has to state both at the address it names; the rule has to keep saying
 * them, so a page whose copy is right about a rule the README has moved on from fails here.
 */
function refundProblems(reading: Reading): string[] {
  return REFUND_HALVES.flatMap(({ half, rule, route }) => [
    ...(rule.test(reading.rule)
      ? []
      : [`${README}'s refund rule no longer states ${half}: the support page publishes the route to it`]),
    ...(route.test(reading.route)
      ? []
      : [`website/docs/support.mjs states the refund route without ${half}, which the README's rule makes it`])
  ])
}

/**
 * What a page may not promise, as the shapes a refund window takes: a refund bound to a number
 * of days, one dressed as a policy or a set of terms, and a money-back guarantee. The decision
 * is that the page states the route and no terms, and these are the shapes a term arrives in.
 */
const REFUND_TERMS: Array<{ what: string; pattern: RegExp }> = [
  {
    what: 'a refund window',
    pattern:
      /\brefund[^.]{0,40}\b(?:within|after|inside|up to)\b[^.]{0,20}\b(?:\d+|one|two|three|seven|fourteen|thirty|sixty|ninety)\b[^.]{0,12}\b(?:days?|weeks?|months?)\b/i
  },
  {
    what: 'a refund window',
    pattern:
      /\b(?:\d+|seven|fourteen|thirty|sixty|ninety)[- ](?:day|week|month)s?\b[^.]{0,30}\b(?:refund|money[- ]back)\b/i
  },
  { what: 'refund terms', pattern: /\brefund\s+(?:policy|terms|conditions|period|window)\b/i },
  { what: 'a money-back guarantee', pattern: /\bmoney[- ]back\s+guarantee\b/i }
]

/**
 * The window or the terms a page states where it publishes a route, each named as the phase it
 * took and as the page it sits on. Both pages are read: the trade the decision refuses is a
 * refund published with a window, and the trial page can grow one as easily as this page can.
 */
function refundTermProblems(reading: Reading): string[] {
  const pages = [
    { file: 'website/support.html', html: reading.rendered },
    { file: 'website/trial.html', html: reading.trialRendered }
  ]
  return pages.flatMap(page =>
    REFUND_TERMS.flatMap(term => {
      const found = term.pattern.exec(decoded(page.html))
      return found === null
        ? []
        : [
            `${page.file} states ${term.what} ("${found[0]}"): the refund route is published without a window and without terms`
          ]
    })
  )
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
      'website/docs/contact.mjs declares no value for ORDER_EMAIL (the one address): fill it with the inbox that answers — while it is empty the support page offers no way to write'
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
        `the rendered page names the address ${address}, and the only one the support page may name is the address the shop front declares (${reading.address})`
      )
    }
  }
  const mailtos = [...rendered.matchAll(/href="(mailto:[^"]*)"/gi)].map(match => mailAddress(match[1]))
  if (!mailtos.some(address => address.toLowerCase() === reading.address.toLowerCase())) {
    problems.push(
      `the rendered page carries no mailto link to the address the support page declares (${reading.address}): a buyer asks for a refund somewhere, and the address is where`
    )
  }
  const turnarounds = [...rendered.matchAll(TURNAROUND)].map(match => match[1].replace(/\s+/g, ' ').trim())
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
            `the rendered page carries the link ${href}: the support page's only route off the site is the address it declares (${reading.address})`
          ]
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(href)) {
      return [
        `the rendered page carries the link ${href}: the support page offers no channel that is not the address it declares, so a link off the site is not one it can offer`
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
      `the support page's nav check: website/${file} carries no <nav class="top-nav">, so the nav it serves cannot be read`
    )
  }
  return nav[1]
}

/** The support page's link, as the nav carries it from the root and from a page a directory down. */
const SUPPORT_LINK = /<a href="(?:\.\/|\.\.\/)?support\.html"[^>]*>Support<\/a>/

/**
 * The pages whose primary nav does not carry the support page's link, and the NAV list behind
 * them. A nav that offers the page on some pages and not on others is the route half-published,
 * so every page the site serves is read — the generated ones through the list the renderer used,
 * the hand-written ones as the files they are.
 */
function navProblems(reading: Reading): string[] {
  const problems: string[] = []
  if (!reading.pages.some(page => page.file === 'support.html')) {
    problems.push('website/support.html is not among the pages the site serves: the nav links to a page a buyer cannot open')
  }
  if (!reading.nav.some(([href, label]) => href === 'support.html' && label === 'Support')) {
    problems.push(
      "website/build-docs.mjs's NAV carries no ['support.html', 'Support'] entry, so no page the docs build writes can reach the support page"
    )
  }
  return problems.concat(
    reading.pages
      .filter(page => !SUPPORT_LINK.test(primaryNav(page.file, page.text)))
      .map(
        page =>
          `website/${page.file}'s primary nav carries no link to website/support.html: the support page must be one of the links on every page the site serves`
      )
  )
}

describe('the support page', () => {
  it('states each of its facts in the words its source uses for them', () => {
    expect(factProblems(LIVE)).toEqual([])
  })

  it('renders every row and sentence the module declares', () => {
    expect(renderedProblems(LIVE)).toEqual([])
  })

  it('answers for the free app and for Pro, one row each, whole', () => {
    expect(coverageProblems(LIVE)).toEqual([])
  })

  it('publishes the refund route the README states, and no window or terms', () => {
    expect(refundProblems(LIVE)).toEqual([])
    expect(refundTermProblems(LIVE)).toEqual([])
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
 * exist to refuse — a control the app has moved, a note the page rewords, half the coverage, a
 * refund with a window, a second address, a turnaround nobody agreed to, a link that goes
 * nowhere, a nav that loses the page — and nothing else in the suite exercises them.
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

  /** The live reading with one coverage row replaced. */
  function withCoverage(reading: Reading, who: string, change: Partial<Coverage>): Reading {
    return { ...reading, coverage: reading.coverage.map(row => (row.who === who ? { ...row, ...change } : row)) }
  }

  it('names the app control the page points at that the app no longer carries', () => {
    const moved = withSource(LIVE, LICENSE_SECTION, 'export function LicenseSection() {\n  return null\n}')
    expect(factProblems(moved)).toEqual([
      expect.stringContaining('src/renderer/src/components/license/LicenseSection.tsx no longer carries the button that takes a key off a machine'),
      expect.stringContaining('src/renderer/src/components/license/LicenseSection.tsx no longer carries the note that says what deactivating leaves')
    ])
  })

  it('names the app sentence the page quotes when the app has reworded it', () => {
    const reworded = withFact(LIVE, 'the note that says what deactivating leaves', {
      stated: 'Deactivating returns this machine to the free app.'
    })
    expect(factProblems(reworded)).toEqual([
      expect.stringContaining('website/docs/support.mjs states "Deactivating returns this machine to the free app." for the note that says what deactivating leaves')
    ])
  })

  it('names a page that answers for Pro and not for the free app', () => {
    const half = { ...LIVE, coverage: LIVE.coverage.filter(row => !/\bfree\b/i.test(row.who)) }
    expect(coverageProblems(half)).toEqual([
      expect.stringContaining('website/docs/support.mjs declares 1 coverage rows'),
      expect.stringContaining('the page declares 0 coverage rows for the free app')
    ])
  })

  it('names a coverage row that covers nothing', () => {
    const empty = withCoverage(LIVE, 'Cuerunner Pro', { prose: '' })
    expect(coverageProblems(empty)).toEqual([
      expect.stringContaining('the page\'s "Cuerunner Pro" row covers nothing')
    ])
  })

  it('names a coverage row a placeholder was left in', () => {
    const placeholder = withCoverage(LIVE, 'The free app', { prose: 'TODO: say what is covered here.' })
    expect(coverageProblems(placeholder)).toEqual([
      expect.stringContaining('the page\'s "The free app" row reads "TODO: say what is covered here.", which is a placeholder'),
      expect.stringContaining('the rendered page does not carry what the "The free app" row covers')
    ])
  })

  it('names a coverage row the rendered page does not carry', () => {
    const dropped = { ...LIVE, rendered: LIVE.rendered.replace(COVERAGE[0].prose, '') }
    expect(coverageProblems(dropped)).toEqual([
      expect.stringContaining('the rendered page does not carry what the "The free app" row covers')
    ])
  })

  it('names a refund rule the README has stopped stating, half by half', () => {
    const moved = { ...LIVE, rule: 'A refund is a conversation with the seller.' }
    expect(refundProblems(moved)).toEqual([
      expect.stringContaining("README.md's refund rule no longer states the row marked refunded"),
      expect.stringContaining("README.md's refund rule no longer states the request to deactivate")
    ])
  })

  it('names a refund route that loses half of the rule it publishes', () => {
    const half = { ...LIVE, route: 'A refund is available on request.' }
    expect(refundProblems(half)).toEqual([
      expect.stringContaining('website/docs/support.mjs states the refund route without the row marked refunded'),
      expect.stringContaining('website/docs/support.mjs states the refund route without the request to deactivate')
    ])
  })

  it('names a refund window or a set of terms the page states', () => {
    const windowed = { ...LIVE, rendered: `${LIVE.rendered}\n<p>Refunds within 30 days of purchase.</p>` }
    expect(refundTermProblems(windowed)).toEqual([
      expect.stringContaining('website/support.html states a refund window ("Refunds within 30 days")')
    ])
    const policy = { ...LIVE, rendered: `${LIVE.rendered}\n<p>See the refund policy for details.</p>` }
    expect(refundTermProblems(policy)).toEqual([
      expect.stringContaining('website/support.html states refund terms ("refund policy")')
    ])
    const guarantee = { ...LIVE, rendered: `${LIVE.rendered}\n<p>Backed by a money-back guarantee.</p>` }
    expect(refundTermProblems(guarantee)).toEqual([
      expect.stringContaining('website/support.html states a money-back guarantee ("money-back guarantee")')
    ])
  })

  it('names a refund window the other page states, since either page can grow one', () => {
    const trial = { ...LIVE, trialRendered: `${LIVE.trialRendered}\n<p>Refunds within 14 days.</p>` }
    expect(refundTermProblems(trial)).toEqual([
      expect.stringContaining('website/trial.html states a refund window ("Refunds within 14 days")')
    ])
  })

  it('names a page that keeps the note about deactivating and loses the way to the switch', () => {
    const buried = { ...LIVE, rendered: LIVE.rendered.replace(DEACTIVATION_PATH, '') }
    expect(renderedProblems(buried)).toEqual([
      expect.stringContaining(`the rendered page does not carry "${DEACTIVATION_PATH}"`)
    ])
  })

  it('reads a link to the site root as the site it serves, and refuses one it does not hold', () => {
    const rooted = { ...LIVE, rendered: `${LIVE.rendered}\n<a href="/pricing.html">Pricing</a>` }
    expect(deadLinkProblems(rooted)).toEqual([])
    const missing = { ...LIVE, rendered: `${LIVE.rendered}\n<a href="/price.html">Pricing</a>` }
    expect(deadLinkProblems(missing)).toEqual([
      expect.stringContaining('the rendered page links to /price.html, which the site does not hold')
    ])
  })

  it('reads a mailto carrying a subject or a fragment as the address it is', () => {
    const prefilled = { ...LIVE, rendered: `${LIVE.rendered}\n<a href="mailto:${ORDER_EMAIL}?subject=Refund">Ask</a>` }
    expect(deadLinkProblems(prefilled)).toEqual([])
    expect(renderedPromiseProblems(prefilled)).toEqual([])
    const elsewhere = { ...LIVE, rendered: `${LIVE.rendered}\n<a href="mailto:help@cuerunner.app#top">Ask</a>` }
    expect(deadLinkProblems(elsewhere)).toEqual([
      expect.stringContaining('the rendered page carries the link mailto:help@cuerunner.app#top')
    ])
  })

  it('names a second address on the rendered page', () => {
    const copied = { ...LIVE, rendered: `${LIVE.rendered}\n<a href="mailto:help@cuerunner.app">help@cuerunner.app</a>` }
    expect(renderedPromiseProblems(copied)).toEqual([
      expect.stringContaining('the rendered page names the address help@cuerunner.app')
    ])
  })

  it('names a page that names an address and never says how long an answer takes', () => {
    const silent = { ...LIVE, rendered: LIVE.rendered.split(`within ${REPLY_WITHIN}`).join('soon') }
    expect(renderedPromiseProblems(silent)).toEqual([
      expect.stringContaining('the rendered page does not state the reply the seller commits to ("one business day")')
    ])
  })

  it('names a turnaround the seller never made', () => {
    const invented = { ...LIVE, rendered: LIVE.rendered.split(`within ${REPLY_WITHIN}`).join('within 48 hours') }
    expect(renderedPromiseProblems(invented)).toEqual([
      expect.stringContaining('the rendered page promises "48 hours", and the reply the seller commits to is "one business day"'),
      expect.stringContaining('the rendered page does not state the reply the seller commits to ("one business day")')
    ])
  })

  it('names a reply the seller has not committed to', () => {
    expect(promiseProblems({ ...LIVE, reply: 'two business days' })).toEqual([])
    expect(promiseProblems({ ...LIVE, reply: '' })).toEqual([
      expect.stringContaining('website/docs/contact.mjs declares no value for REPLY_WITHIN')
    ])
    expect(promiseProblems({ ...LIVE, reply: 'as soon as we can' })).toEqual([
      expect.stringContaining('REPLY_WITHIN reads "as soon as we can", which is not a reply time a sentence can promise')
    ])
    expect(promiseProblems({ ...LIVE, address: 'orders@example.com' })).toEqual([
      expect.stringContaining('ORDER_EMAIL reads "orders@example.com", which is a placeholder')
    ])
    expect(promiseProblems({ ...LIVE, address: 'orders at cuerunner dot app' })).toEqual([
      expect.stringContaining('ORDER_EMAIL reads "orders at cuerunner dot app", which is not one email address')
    ])
  })

  it('names a link a reader cannot open', () => {
    const dead = { ...LIVE, rendered: LIVE.rendered.replace('href="guide.html"', 'href="the-guide.html"') }
    expect(deadLinkProblems(dead)).toEqual([
      expect.stringContaining('the rendered page links to the-guide.html, which the site does not hold')
    ])
  })

  it('names a channel that is not the address the page declares', () => {
    const elsewhere = { ...LIVE, rendered: `${LIVE.rendered}\n<a href="tel:+15551234567">Call us</a>` }
    expect(deadLinkProblems(elsewhere)).toEqual([
      expect.stringContaining('the rendered page carries the link tel:+15551234567')
    ])
  })

  it('names the hand-written page whose nav loses the support page link', () => {
    const drifted = LIVE.pages.map(page =>
      page.file === 'index.html'
        ? { ...page, text: page.text.replace('        <a href="./support.html">Support</a>\n', '') }
        : page
    )
    expect(navProblems({ ...LIVE, pages: drifted })).toEqual([
      expect.stringContaining("website/index.html's primary nav carries no link to website/support.html")
    ])
  })

  it('names the NAV list a generated page would lose the link from', () => {
    const without = LIVE.nav.filter(([href]) => href !== 'support.html')
    expect(navProblems({ ...LIVE, nav: without })).toEqual([
      expect.stringContaining("NAV carries no ['support.html', 'Support'] entry")
    ])
  })

  it('names the site that serves no support page at all', () => {
    const without = LIVE.pages.filter(page => page.file !== 'support.html')
    expect(navProblems({ ...LIVE, pages: without })).toEqual([
      expect.stringContaining('website/support.html is not among the pages the site serves')
    ])
  })
})

/**
 * The guard reads the app and the README, and a source it cannot read is a failure rather than
 * an empty pass: facts compared against nothing is the vacuous run the sources exist to prevent.
 */
describe('the sources the guard reads', () => {
  it('fails loudly on a source file that cannot be read', () => {
    expect(() => readSource('src/renderer/src/components/license/LicenceSection.tsx')).toThrow('which cannot be read')
  })

  it('fails loudly on a README that has stopped stating the refund rule', () => {
    expect(() => refundRule('# Cuerunner\n\nNo refunds here.\n')).toThrow(
      'README.md no longer states the refund rule'
    )
  })

  it('reads a fact out of a file that wraps it, and a fact that has moved as nothing', () => {
    expect(group(/\{\s*action:\s*'settings',\s*label:\s*'([^']+)'/)(readSource(FILE_MENU))).toBe('Settings…')
    expect(words(/Deactivating puts this machine back to the free app[^<]*/)(readSource(LICENSE_SECTION))).toBe(
      'Deactivating puts this machine back to the free app. Your shows are untouched.'
    )
    expect(group(/\{\s*id:\s*'license',\s*label:\s*'([^']+)'/)(readSource(FILE_MENU))).toBeUndefined()
  })
})
