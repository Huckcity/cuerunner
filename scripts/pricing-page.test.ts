// The price page, held to the record's adopted model and to the routes it declares.
//
// `website/pricing.html` answers the two questions a buyer arrives with — what does it cost,
// and how do I pay — and nothing read it: its figures were its own words, so a stale price or
// a typo would ship exactly as written. The rows are declared now (website/docs/pricing.mjs),
// so this guard reads that declaration against the money record — the adopted model in
// `_bmad-output/specs/spec-cuerunner/market-and-business.md` (decision D2) — row by row: each
// row names the bullet it prices, states that bullet's figures in the record's own notation
// (so `$99` cannot stand in for `$99/machine`, and two figures that read alike do not cover
// for each other) and states the durations and machine counts that bullet's prose sets. Every
// priced bullet must be priced by a row, so a price D2 adds or moves fails naming it.
//
// **What the reading covers.** The record's money and, of its prose, the durations and machine
// counts a bullet sets — those are the terms a price is bought on. Every other class of term
// (what an update includes, what a route serves, who a licence is for) is prose a buyer reads,
// not a figure this guard holds; and the page's own prose beyond `includes` is not read at all.
//
// The routes are declared once and held to a shape: a live `https://` link for the card route,
// an address for the purchase-order inbox, and the words that say how the W-9 comes back.
// Empty and placeholder values fail by name — the two route values are the seller's and arrive
// after the page does, so this guard is red on them until they are filled, which is the
// branch's intended state and never a case to silence. Every page the site serves is read back
// for the price page's link in its primary nav.
//
// Every check is a pure function of what it reads, so the second describe can hand it a page
// the repository would never commit and get the failure back by name. The failure paths are
// what hold the page; a passing run on its own says only that nothing has drifted yet.
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// @ts-ignore — js file, no type declarations
import { BY_CONVERSATION, CARD_LINK, ORDER_EMAIL, PRICED_SKUS, PRICING, W9_ROUTE } from '../website/docs/pricing.mjs'
// @ts-ignore — js file, no type declarations
import { NAV, renderPage } from '../website/build-docs.mjs'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

/** One declared row of the price page, as this guard reads it. */
interface Sku {
  label: string
  /** The record's own phrase for the bullet this row prices. */
  record: string
  figures: string[]
  includes: string
  route: string
  conversation: boolean
}

/** A figure money is stated in, read from either side of the comparison as the same thing. */
interface Figure {
  kind: 'usd' | 'off'
  amount: number
  /** The figure as it was written, so a failure can name it the way the record or the page does. */
  text: string
}

/** A term a bullet's prose sets: how long something runs, or how many machines it covers. */
interface Term {
  unit: 'day' | 'month' | 'year' | 'machine'
  count: number
}

/** One bullet of the record's adopted model, read as the money and the terms it sets. */
interface Bullet {
  /** The bullet's own words, markdown stripped: what a row's declarations are held to. */
  text: string
  /** The amounts the bullet states. */
  amounts: Figure[]
  /** The durations and machine counts its prose sets, never the ones inside a price. */
  terms: Term[]
}

/**
 * One route the page declares: the constant that holds it, what a buyer it is for reads, and
 * what a live value reads like. The card link is a page a buyer visits and the purchase-order
 * address is an inbox; the W-9 has no value at all — it comes back by email — so its shape is
 * the words that say how.
 */
interface Route {
  name: string
  value: string
  what: string
  want: string
  live: (value: string) => boolean
}

/**
 * Every figure a text states: dollars as the record and the page write them (`$249`,
 * `$12/day`, `$99 for 90 days`) and a discount on every SKU (`50% off`). The page and the
 * record need not use the same notation — the comparison is made on the figure, not the
 * wording — while a percentage that is not a discount ("~20%", "40% of QLab's entry") is a
 * comparison rather than an offer and is left alone.
 */
function figuresIn(text: string): Figure[] {
  return [
    ...[...text.matchAll(/\$\s*([\d,]+)/g)].map(match => ({
      kind: 'usd' as const,
      amount: Number(match[1].replace(/,/g, '')),
      text: match[0].replace(/\s+/g, '')
    })),
    ...[...text.matchAll(/([\d.]+)%\s*off\b/g)].map(match => ({
      kind: 'off' as const,
      amount: Number(match[1]),
      text: `${match[1]}% off`
    }))
  ]
}

/** The counts this repo's prose writes as words. */
const COUNTS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12
}

/**
 * A duration or a machine count as a bullet's prose sets it — never the one inside a price, so
 * `$12/day` and `$99/90 days` contribute no term (`(?<![\d$/])`: the amount a unit belongs to
 * is money when it opens with `$` or follows the `/` of a figure).
 */
const TERM = /(?<![\d$/])(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)[-\s]?(days?|months?|years?|machines?)\b/gi

/** The durations and machine counts a text sets, as the terms themselves. */
function termsIn(text: string): Term[] {
  return [...text.matchAll(TERM)].map(match => ({
    unit: match[2].toLowerCase().replace(/s$/, '') as Term['unit'],
    count: COUNTS[match[1].toLowerCase()] ?? Number(match[1])
  }))
}

/** Where the money record lives: the input of the figure checks, named for the failures they write. */
const recordPath = path.join(root, '_bmad-output', 'specs', 'spec-cuerunner', 'market-and-business.md')

/**
 * The record as text, or a failure. The money copy has no other authority, and a reading that
 * came back empty would let every figure through, so a record that cannot be opened is loud.
 */
function readRecord(at: string = recordPath): string {
  try {
    return fs.readFileSync(at, 'utf-8')
  } catch (error) {
    throw new Error(
      `the money record could not be read at ${at} (${error instanceof Error ? error.message : String(error)}): the price page is held to its adopted model, so a run that cannot open it must not pass`
    )
  }
}

/**
 * The bullets under the record's adopted model, in file order — never an empty list. The
 * heading is the record's own, and a bullet that wrapped is joined back together, so a renamed
 * heading or a moved price stops the run rather than reading as a model with nothing left in
 * it.
 */
function adoptedModel(markdown: string): string[] {
  const lines = markdown.split('\n')
  const start = lines.findIndex(line => line.trim() === '## Adopted model (decision D2)')
  if (start === -1) {
    throw new Error(
      "the money record carries no '## Adopted model (decision D2)' section: the prices are read from its bullets, so a section this guard cannot find is not a model with nothing to say"
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
      "the record's adopted model carries no bullets: the prices are read from them, so an empty section is a failure rather than a model with nothing in it"
    )
  }
  return bullets
}

/**
 * The bullet that prices the decision rather than a SKU — "$249 is a judgement, not a
 * derivation; $199–299 is defensible". Its figures are the reasoning behind the price, not an
 * offer a row could sell, so they are read by a person and skipped here: by name, and loudly
 * when the bullet this guard skips is no longer there to skip.
 */
const JUDGEMENT = /is a judgement/

/**
 * The record's priced bullets: everything the adopted model sets, minus the judgement and
 * minus a bullet that states no figure — a free offer among them is not a price a row carries.
 */
function pricedBullets(markdown: string): string[] {
  const bullets = adoptedModel(markdown)
  const judgement = bullets.filter(bullet => JUDGEMENT.test(bullet)).length
  if (judgement !== 1) {
    throw new Error(
      `the record's adopted model carries ${judgement} bullets that read as a judgement (${JUDGEMENT.source}): this guard skips the judgement's own figures, so it must find exactly one to skip`
    )
  }
  return bullets.filter(bullet => !JUDGEMENT.test(bullet) && figuresIn(bullet).length > 0)
}

/**
 * A route typed as a placeholder rather than supplied: the shapes a value takes when the
 * sentence around it was written first, including the reserved names a documentation example
 * uses. Refused by name so a page cannot ship a route that does not exist.
 */
const PLACEHOLDER =
  /\b(?:placeholder|todo|tbd|fixme|changeme|example|foo|bar|yoursite|xxx|your-(?:store|link|domain|address|site))\b|\.(?:test|invalid)\b|…/i

/** The routes the page declares, in the order it names them, with the shape each live one has. */
const ROUTES: Route[] = [
  {
    name: 'CARD_LINK',
    value: CARD_LINK,
    what: 'the card route',
    want: 'a live https:// link to the storefront',
    live: value => /^https:\/\/\S+$/.test(value)
  },
  {
    name: 'ORDER_EMAIL',
    value: ORDER_EMAIL,
    what: 'the purchase-order address',
    want: 'one email address',
    live: value => /^\S+@\S+\.\S+$/.test(value)
  },
  {
    name: 'W9_ROUTE',
    value: W9_ROUTE,
    what: 'the W-9 route',
    want: 'the words that say how the form comes back',
    live: value => /email/i.test(value)
  }
]

/** Everything the checks read, in one value: a case below hands them a mutation of it. */
interface Reading {
  skus: Sku[]
  routes: Route[]
  /** The record's priced bullets, which is every price the page may state. */
  bullets: Bullet[]
  /** The price page as the site serves it. */
  rendered: string
  /** Every page the site serves, read as the file `deploy-website.yml` uploads. */
  pages: Array<{ file: string; text: string }>
  /** The links across the top of every generated page. */
  nav: string[][]
}

/** The page this guard reads, found by its own path rather than by where it sits in the list. */
const PRICE_PAGE = PRICING.find((page: { path: string }) => page.path === 'pricing.html')
if (PRICE_PAGE === undefined) {
  throw new Error('website/docs/pricing.mjs no longer declares pricing.html: this guard reads the buyer page by its path')
}

/** Every page the site serves, as `deploy-website.yml` uploads them: the tree as it stands. */
function servedPages(): Array<{ file: string; text: string }> {
  let entries: string[]
  try {
    entries = fs.readdirSync(path.join(root, 'website'), { recursive: true, encoding: 'utf-8' })
  } catch (cause) {
    throw new Error(`the price page's nav check: website/ cannot be walked — ${(cause as Error).message}`)
  }
  const pages = entries.map(entry => entry.split(path.sep).join('/')).filter(entry => entry.endsWith('.html')).sort()
  if (pages.length === 0) {
    throw new Error("the price page's nav check: website/ holds no page to read, so a pass here would mean nothing")
  }
  return pages.map(file => {
    try {
      return { file, text: fs.readFileSync(path.join(root, 'website', file), 'utf-8') }
    } catch (cause) {
      throw new Error(`the price page's nav check: website/${file} cannot be read — ${(cause as Error).message}`)
    }
  })
}

/** The page as the repository holds it, the record as the record states it. */
const LIVE: Reading = {
  skus: PRICED_SKUS,
  routes: ROUTES,
  bullets: pricedBullets(readRecord()).map(text => ({
    text: text.replace(/\*\*/g, ''),
    amounts: figuresIn(text),
    terms: termsIn(text)
  })),
  rendered: renderPage(PRICE_PAGE),
  pages: servedPages(),
  nav: NAV
}

/**
 * The rendered page with the markup's entities put back, so a route carrying an ampersand is
 * read as the buyer reads it: the page escapes what it renders into href, and a comparison
 * against the declaration has to be made on the words rather than on the escaping.
 */
function decoded(html: string): string {
  return html.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
}

/**
 * The reading as it stands once the seller has supplied both values — the state the page ships
 * in. A row's route is the value its kind of purchase uses, so the rows are pressed from the
 * same two values the way the page module presses them: the conversation rows take the
 * address, the rest the storefront link. Cases that test a row's route use this rather than
 * the branch's own unfilled state, where both values are empty and every route compares equal.
 */
function supplied(reading: Reading): Reading {
  const card = 'https://buy.cuerunner.app/pro'
  const order = 'orders@cuerunner.app'
  return {
    ...reading,
    routes: reading.routes.map(route =>
      route.name === 'CARD_LINK'
        ? { ...route, value: card }
        : route.name === 'ORDER_EMAIL'
          ? { ...route, value: order }
          : route
    ),
    skus: reading.skus.map(row => ({ ...row, route: row.conversation ? order : card }))
  }
}

/**
 * The rows' prices, held to the bullet each names. A row prices exactly one bullet; it states
 * no figure that bullet does not write (and does not stop short of one, so `$99` cannot stand
 * for `$99/machine`); it states every figure the bullet writes, so two figures that read alike
 * do not cover for each other; and it states the durations and machine counts the bullet's
 * prose sets. Every priced bullet must be priced by some row, so a price the page drops — or
 * one D2 gains — fails naming the bullet that sets it.
 */
function priceProblems(reading: Reading): string[] {
  const problems: string[] = []
  const priced = new Set<Bullet>()
  for (const row of reading.skus) {
    const bullets = reading.bullets.filter(bullet => bullet.text.includes(row.record))
    if (bullets.length !== 1) {
      problems.push(
        bullets.length === 0
          ? `the page's "${row.label}" row prices "${row.record}" and the record's adopted model carries no bullet stating it`
          : `the page's "${row.label}" row prices "${row.record}" and ${bullets.length} bullets of the record's adopted model state it`
      )
      continue
    }
    const bullet = bullets[0]
    priced.add(bullet)
    for (const figure of row.figures) {
      const at = bullet.text.indexOf(figure)
      if (at === -1) {
        problems.push(`the page's "${row.label}" row states ${figure}, which the bullet it prices does not state`)
        continue
      }
      const after = bullet.text.slice(at + figure.length)
      if (/^[/\w]/.test(after)) {
        problems.push(
          `the page's "${row.label}" row states ${figure} where the record writes more of the figure: "${bullet.text.slice(at, at + 24)}${after.length > 24 ? '…' : ''}"`
        )
      }
    }
    const stated = figuresIn(row.figures.join(' '))
    for (const amount of bullet.amounts) {
      if (!stated.some(figure => figure.kind === amount.kind && figure.amount === amount.amount)) {
        problems.push(`the bullet the page's "${row.label}" row prices states ${amount.text} and the row does not state it`)
      }
    }
    if (row.includes.trim() === '') {
      problems.push(`the page's "${row.label}" row states a price and nothing about what it includes`)
    } else {
      const terms = termsIn(row.includes)
      for (const term of bullet.terms) {
        if (!terms.some(candidate => candidate.unit === term.unit && candidate.count === term.count)) {
          problems.push(
            `the page's "${row.label}" row states what the price includes without the bullet's ${term.count} ${term.unit}${term.count === 1 ? '' : 's'}: a term the record sets belongs with the price`
          )
        }
      }
    }
  }
  for (const bullet of reading.bullets) {
    if (!priced.has(bullet)) {
      problems.push(
        `the record's adopted model states ${bullet.amounts.map(amount => amount.text).join(', ')} in "${bullet.text}", and no row on the page prices it`
      )
    }
  }
  return problems
}

/** The same money again, read off the rendered page: a figure in a row's prose is a price too. */
function renderedFigureProblems(reading: Reading): string[] {
  const inRecord: Record<string, Figure> = {}
  for (const bullet of reading.bullets) {
    for (const amount of bullet.amounts) inRecord[`${amount.kind}:${amount.amount}`] = amount
  }
  const onPage: Record<string, Figure> = {}
  for (const figure of figuresIn(decoded(reading.rendered))) onPage[`${figure.kind}:${figure.amount}`] = figure
  return [
    ...Object.entries(inRecord)
      .filter(([figure]) => !(figure in onPage))
      .map(([, figure]) => `the record states ${figure.text} and the rendered page does not state it`),
    ...Object.entries(onPage)
      .filter(([figure]) => !(figure in inRecord))
      .map(([, figure]) => `the rendered page states ${figure.text}, which the record's adopted model does not set`)
  ]
}

/**
 * The rows whose purchase is not the route their kind needs: a self-serve row sells through
 * the card link and a conversation row through the purchase-order address, never each other's
 * and never a route the page does not declare. A purchase that is not a checkout is not
 * dressed as one, and a checkout is not dressed as a conversation.
 */
function rowRouteProblems(reading: Reading): string[] {
  const card = reading.routes.find(route => route.name === 'CARD_LINK')?.value ?? ''
  const order = reading.routes.find(route => route.name === 'ORDER_EMAIL')?.value ?? ''
  return reading.skus.flatMap(row => {
    const expected = row.conversation ? order : card
    if (row.route === expected) return []
    if (row.route.trim() === '') {
      return [
        `the page's "${row.label}" row states a price and carries no route: a priced row offers ${row.conversation ? 'the purchase-order address' : 'the card link the page declares'}`
      ]
    }
    return [
      row.conversation
        ? `the page's "${row.label}" row takes a conversation and offers "${row.route}" instead of the purchase-order address: a purchase that is not a checkout must not be dressed as one`
        : `the page's "${row.label}" row is self-serve and offers "${row.route}" instead of the card link the page declares`
    ]
  })
}

/**
 * One rendered row of the price table, found by the label in its first cell — never by its
 * position, so reordering the rows cannot point a check at the wrong one.
 */
function rowMarkup(rendered: string, label: string): string | undefined {
  for (const row of rendered.split('<tr>').slice(1)) {
    const close = row.indexOf('</tr>')
    if (close === -1) continue
    const cells = row.slice(0, close)
    if (cells.includes(`<td>${label}</td>`)) return cells
  }
  return undefined
}

/**
 * Every row as the rendered page carries it: the label the row is found by, what the price
 * includes, the figures it declares, the route it declares and — where the purchase is a
 * conversation — the words that say so. This is the half a declaration alone cannot hold: a
 * row can be declared perfectly and rendered as something else.
 */
function rowRenderProblems(reading: Reading): string[] {
  const rendered = decoded(reading.rendered)
  return reading.skus.flatMap(row => {
    const cells = rowMarkup(rendered, row.label)
    if (cells === undefined) {
      return [`the rendered page carries no "${row.label}" row: a declared row nothing renders is a page and a declaration that disagree`]
    }
    const problems: string[] = []
    if (row.includes !== '' && !cells.includes(row.includes)) {
      problems.push(`the page's "${row.label}" row declares what the price includes and the rendered row does not carry it`)
    }
    for (const figure of row.figures) {
      if (!cells.includes(figure)) {
        problems.push(`the page's "${row.label}" row declares the figure ${figure} and the rendered row does not state it`)
      }
    }
    if (row.route !== '' && !cells.includes(row.route)) {
      problems.push(`the page's "${row.label}" row declares its route and the rendered row does not carry it`)
    }
    if (row.conversation && !cells.includes(BY_CONVERSATION)) {
      problems.push(`the page's "${row.label}" row takes a conversation and the rendered row does not say so ("${BY_CONVERSATION}")`)
    }
    if (!row.conversation && cells.includes(BY_CONVERSATION)) {
      problems.push(`the page's "${row.label}" row is self-serve and the rendered row says "${BY_CONVERSATION}"`)
    }
    return problems
  })
}

/**
 * The routes that hold no value, hold a placeholder instead of one, or carry markup. An empty
 * route is a failure rather than a skip: the page offers no way to buy, and the seller's value
 * is what clears it.
 */
function routeProblems(reading: Reading): string[] {
  return reading.routes.flatMap(route => {
    if (route.value.trim() === '') {
      return [
        `website/docs/pricing.mjs declares no value for ${route.name} (${route.what}): fill it with ${route.want} — while it is empty the page offers no way to buy`
      ]
    }
    if (PLACEHOLDER.test(route.value)) {
      return [`${route.name} reads "${route.value}", which is a placeholder rather than ${route.want}`]
    }
    if (/[<>"]/.test(route.value)) {
      return [`${route.name} reads "${route.value}", which carries markup: a route is rendered into the page's markup, so it may not carry <, > or a quote`]
    }
    if (!route.live(route.value)) {
      return [`${route.name} reads "${route.value}", which is not ${route.want}`]
    }
    return []
  })
}

/** The routes the rendered page does not carry from their declaration: a route declared and never rendered is not one. */
function renderedRouteProblems(reading: Reading): string[] {
  const rendered = decoded(reading.rendered)
  return reading.routes
    .filter(route => route.value.trim() !== '' && !rendered.includes(route.value))
    .map(route => `the rendered page does not carry ${route.what} from its declaration (${route.name})`)
}

/** The primary nav of a page, as the markup that carries it — a page without one fails loudly rather than skipping. */
function primaryNav(file: string, html: string): string {
  const nav = /<nav class="top-nav"[^>]*>([\s\S]*?)<\/nav>/.exec(html)
  if (nav === null) {
    throw new Error(
      `the price page's nav check: website/${file} carries no <nav class="top-nav">, so the nav it serves cannot be read`
    )
  }
  return nav[1]
}

/** The price page's link, as the nav carries it from the root and from a page a directory down. */
const PRICING_LINK = /<a href="(?:\.\/|\.\.\/)?pricing\.html"[^>]*>Pricing<\/a>/

/**
 * The pages whose primary nav does not carry the price page's link, and the NAV list behind
 * them. A nav that offers the route on some pages and not on others is the route
 * half-published, so every page the site serves is read — the generated ones through the list
 * the renderer used, the hand-written ones as the files they are.
 */
function navProblems(reading: Reading): string[] {
  const problems: string[] = []
  if (!reading.pages.some(page => page.file === 'pricing.html')) {
    problems.push('website/pricing.html is not among the pages the site serves: the nav links to a page a buyer cannot open')
  }
  if (!reading.nav.some(([href, label]) => href === 'pricing.html' && label === 'Pricing')) {
    problems.push(
      "website/build-docs.mjs's NAV carries no ['pricing.html', 'Pricing'] entry, so no page the docs build writes can reach the price page"
    )
  }
  return problems.concat(
    reading.pages
      .filter(page => !PRICING_LINK.test(primaryNav(page.file, page.text)))
      .map(
        page =>
          `website/${page.file}'s primary nav carries no link to website/pricing.html: the price page must be one of the links on every page the site serves`
      )
  )
}

describe('the price page', () => {
  it('states the bullet it prices: its figures, with their units, and its terms', () => {
    expect(priceProblems(LIVE)).toEqual([])
  })

  it('states no figure once rendered that the record does not set', () => {
    expect(renderedFigureProblems(LIVE)).toEqual([])
  })

  it('gives every priced row the route its kind of purchase needs', () => {
    expect(rowRouteProblems(LIVE)).toEqual([])
  })

  it('renders every row with its words, its figures, its route and the kind of purchase it is', () => {
    expect(rowRenderProblems(LIVE)).toEqual([])
  })

  it('declares each route as a live value the seller has supplied', () => {
    expect(routeProblems(LIVE)).toEqual([])
  })

  it('carries each declared route on the rendered page', () => {
    expect(renderedRouteProblems(LIVE)).toEqual([])
  })

  it('links the price page from every page the site serves', () => {
    expect(navProblems(LIVE)).toEqual([])
  })
})

/**
 * The page the repository would never commit, one failure at a time: each case changes one
 * thing in the live reading and asserts the check names it. These are the states the checks
 * exist to refuse — the drifting figure, the price that moved to another row, the row with no
 * way to buy, the route the seller has not supplied yet, the nav that loses the link — and
 * nothing else in the suite exercises them.
 */
describe('the page the checks exist to refuse', () => {
  /** The live rows with one row replaced, found by its label. */
  function withRow(reading: Reading, label: string, change: Partial<Sku>): Reading {
    return { ...reading, skus: reading.skus.map(row => (row.label === label ? { ...row, ...change } : row)) }
  }

  it('names a figure the record does not set', () => {
    const invented = withRow(LIVE, 'A rental', { figures: ['$12/day', '$99/90 days', '$199'] })
    expect(priceProblems(invented)).toEqual([
      expect.stringContaining('the page\'s "A rental" row states $199, which the bullet it prices does not state')
    ])
  })

  it('names a row whose figure belongs to another row', () => {
    const moved = withRow(LIVE, 'A venue or a campus', { figures: ['$999', '$99/90 days'] })
    expect(priceProblems(moved)).toEqual([
      expect.stringContaining('the page\'s "A venue or a campus" row states $99/90 days, which the bullet it prices does not state')
    ])
  })

  it('names the second figure of two that read alike when a row drops it', () => {
    const dropped = withRow(LIVE, 'A venue or a campus', { figures: ['$999'] })
    expect(priceProblems(dropped)).toEqual([
      expect.stringContaining('the bullet the page\'s "A venue or a campus" row prices states $99 and the row does not state it')
    ])
  })

  it('names a row that states a figure without its unit', () => {
    const short = withRow(LIVE, 'A rental', { figures: ['$12/day', '$99'] })
    expect(priceProblems(short)).toEqual([
      expect.stringContaining('the page\'s "A rental" row states $99 where the record writes more of the figure')
    ])
  })

  it('names a row that swaps one unit for another', () => {
    const swapped = withRow(LIVE, 'A rental', { figures: ['$12/day', '$99 a day'] })
    expect(priceProblems(swapped)).toEqual([
      expect.stringContaining('the page\'s "A rental" row states $99 a day, which the bullet it prices does not state')
    ])
  })

  it('names a price the record sets that no row prices', () => {
    const without = LIVE.skus.filter(row => row.label !== 'A rental')
    expect(priceProblems({ ...LIVE, skus: without })).toEqual([
      expect.stringContaining('the record\'s adopted model states $12, $99 in "$12/day or $99/90 days rental')
    ])
  })

  it('names a row pricing a bullet the record does not carry', () => {
    const stray = withRow(LIVE, 'A rental', { record: '$149' })
    expect(priceProblems(stray)).toEqual([
      expect.stringContaining('the page\'s "A rental" row prices "$149" and the record\'s adopted model carries no bullet stating it'),
      expect.stringContaining('the record\'s adopted model states $12, $99 in "$12/day or $99/90 days rental')
    ])
  })

  it('names a row whose words lose the terms the bullet sets', () => {
    const terms = withRow(LIVE, 'Cuerunner Pro', { includes: 'One perpetual licence: every Pro capability.' })
    expect(priceProblems(terms)).toEqual([
      expect.stringContaining('the page\'s "Cuerunner Pro" row states what the price includes without the bullet\'s 12 months'),
      expect.stringContaining('the page\'s "Cuerunner Pro" row states what the price includes without the bullet\'s 2 machines')
    ])
  })

  it('names a row that claims terms the bullet does not set', () => {
    const claimed = withRow(LIVE, 'Cuerunner Pro', {
      includes: 'One perpetual licence: 24 months of updates and five machines.'
    })
    expect(priceProblems(claimed)).toEqual([
      expect.stringContaining('the page\'s "Cuerunner Pro" row states what the price includes without the bullet\'s 12 months'),
      expect.stringContaining('the page\'s "Cuerunner Pro" row states what the price includes without the bullet\'s 2 machines')
    ])
  })

  it('names a row that states a price and nothing about what it includes', () => {
    const empty = withRow(LIVE, 'Education', { includes: '' })
    expect(priceProblems(empty)).toEqual([
      expect.stringContaining('the page\'s "Education" row states a price and nothing about what it includes')
    ])
  })

  it('names a figure the rendered page states that the record does not set', () => {
    const typed = LIVE.rendered.replace('<td>$249</td>', '<td>$279</td>')
    expect(renderedFigureProblems({ ...LIVE, rendered: typed })).toEqual([
      expect.stringContaining('the record states $249 and the rendered page does not state it'),
      expect.stringContaining('the rendered page states $279, which the record\'s adopted model does not set')
    ])
  })

  it('names a priced row with no route to buy it', () => {
    const orphaned = supplied(LIVE)
    expect(rowRouteProblems(withRow(orphaned, 'A rental', { route: '' }))).toEqual([
      expect.stringContaining('the page\'s "A rental" row states a price and carries no route')
    ])
  })

  it('names a self-serve row routed to the purchase-order address', () => {
    const misrouted = supplied(LIVE)
    expect(rowRouteProblems(withRow(misrouted, 'A rental', { route: 'orders@cuerunner.app' }))).toEqual([
      expect.stringContaining('the page\'s "A rental" row is self-serve and offers "orders@cuerunner.app" instead of the card link')
    ])
  })

  it('names a row routed to a route that is not a way to buy', () => {
    const stray = supplied(LIVE)
    expect(rowRouteProblems(withRow(stray, 'Cuerunner Pro', { route: W9_ROUTE }))).toEqual([
      expect.stringContaining('the page\'s "Cuerunner Pro" row is self-serve and offers "The completed W-9 comes back by email with the invoice." instead of the card link')
    ])
  })

  it('names a conversation row dressed as a checkout', () => {
    const dressed = supplied(LIVE)
    expect(rowRouteProblems(withRow(dressed, 'A venue or a campus', { route: 'https://buy.cuerunner.app/pro' }))).toEqual([
      expect.stringContaining('the page\'s "A venue or a campus" row takes a conversation and offers "https://buy.cuerunner.app/pro" instead of the purchase-order address')
    ])
  })

  it('names a row whose figures the rendered page loses', () => {
    const withoutPrice = LIVE.rendered.replace('<td>$12/day<br />$99/90 days</td>', '<td>Ask us</td>')
    expect(rowRenderProblems({ ...LIVE, rendered: withoutPrice })).toEqual([
      expect.stringContaining('the page\'s "A rental" row declares the figure $12/day and the rendered row does not state it'),
      expect.stringContaining('the page\'s "A rental" row declares the figure $99/90 days and the rendered row does not state it')
    ])
  })

  it('names a row whose words the rendered page loses', () => {
    const words = LIVE.skus.find(sku => sku.label === 'Education')?.includes ?? ''
    const withoutWords = LIVE.rendered.replace(words, '')
    expect(rowRenderProblems({ ...LIVE, rendered: withoutWords })).toEqual([
      expect.stringContaining('the page\'s "Education" row declares what the price includes and the rendered row does not carry it')
    ])
  })

  it('names a row the rendered page does not carry at all', () => {
    const gutted = LIVE.rendered.replace('<td>Education</td>', '<td>Training</td>')
    expect(rowRenderProblems({ ...LIVE, rendered: gutted })).toEqual([
      expect.stringContaining('the rendered page carries no "Education" row')
    ])
  })

  it('names a row whose conversation the rendered page stops declaring', () => {
    const silent = LIVE.rendered.replaceAll(`<td>${BY_CONVERSATION} —`, '<td>Buy now —')
    expect(rowRenderProblems({ ...LIVE, rendered: silent })).toEqual([
      expect.stringContaining('the page\'s "A venue or a campus" row takes a conversation and the rendered row does not say so'),
      expect.stringContaining('the page\'s "Education" row takes a conversation and the rendered row does not say so')
    ])
  })

  it('names a route the seller has not supplied yet, and the fill that clears it', () => {
    const unsupplied = supplied(LIVE).routes.map(route => (route.name === 'CARD_LINK' ? { ...route, value: '' } : route))
    expect(routeProblems({ ...LIVE, routes: unsupplied })).toEqual([
      expect.stringContaining('website/docs/pricing.mjs declares no value for CARD_LINK (the card route)')
    ])
  })

  it('names a route a placeholder was left in', () => {
    const placeholder = supplied(LIVE).routes.map(route =>
      route.name === 'ORDER_EMAIL' ? { ...route, value: 'orders@example.com' } : route
    )
    expect(routeProblems({ ...LIVE, routes: placeholder })).toEqual([
      expect.stringContaining('ORDER_EMAIL reads "orders@example.com", which is a placeholder rather than one email address')
    ])
  })

  it('names a route pointed at a reserved name, which is documentation rather than a shop', () => {
    const reserved = supplied(LIVE).routes.map(route =>
      route.name === 'CARD_LINK' ? { ...route, value: 'https://buy.example.org/pro' } : route
    )
    expect(routeProblems({ ...LIVE, routes: reserved })).toEqual([
      expect.stringContaining('CARD_LINK reads "https://buy.example.org/pro", which is a placeholder rather than a live https:// link to the storefront')
    ])
    const tld = supplied(LIVE).routes.map(route =>
      route.name === 'CARD_LINK' ? { ...route, value: 'https://buy.cuerunner.test/pro' } : route
    )
    expect(routeProblems({ ...LIVE, routes: tld })).toEqual([
      expect.stringContaining('CARD_LINK reads "https://buy.cuerunner.test/pro", which is a placeholder rather than a live https:// link to the storefront')
    ])
  })

  it('names a route that carries markup into the page', () => {
    const markup = supplied(LIVE).routes.map(route =>
      route.name === 'CARD_LINK' ? { ...route, value: 'https://buy.cuerunner.app/pro<buy>' } : route
    )
    expect(routeProblems({ ...LIVE, routes: markup })).toEqual([
      expect.stringContaining('CARD_LINK reads "https://buy.cuerunner.app/pro<buy>", which carries markup')
    ])
  })

  it('names a route that is not the shape it claims', () => {
    const malformed = supplied(LIVE).routes.map(route =>
      route.name === 'CARD_LINK' ? { ...route, value: 'buy.cuerunner.app/pro' } : route
    )
    expect(routeProblems({ ...LIVE, routes: malformed })).toEqual([
      expect.stringContaining('CARD_LINK reads "buy.cuerunner.app/pro", which is not a live https:// link to the storefront')
    ])
  })

  it('names a route the rendered page does not carry', () => {
    const unbuilt = LIVE.routes
      .filter(route => route.name === 'CARD_LINK')
      .map(route => ({ ...route, value: 'https://buy.cuerunner.app/unbuilt' }))
    expect(renderedRouteProblems({ ...LIVE, routes: unbuilt })).toEqual([
      expect.stringContaining('the rendered page does not carry the card route from its declaration (CARD_LINK)')
    ])
    const nearMiss = LIVE.routes
      .filter(route => route.name === 'W9_ROUTE')
      .map(route => ({ ...route, value: 'The completed W-9 comes back by email with the paperwork.' }))
    expect(renderedRouteProblems({ ...LIVE, routes: nearMiss })).toEqual([
      expect.stringContaining('the rendered page does not carry the W-9 route from its declaration (W9_ROUTE)')
    ])
  })

  it('reads an ampersand the page escapes, and refuses one it does not carry', () => {
    const amp = LIVE.routes
      .filter(route => route.name === 'CARD_LINK')
      .map(route => ({ ...route, value: 'https://buy.cuerunner.app/pro?a=1&b=2' }))
    const carried = `${LIVE.rendered}\n<a href="https://buy.cuerunner.app/pro?a=1&amp;b=2">Buy</a>`
    expect(renderedRouteProblems({ ...LIVE, routes: amp, rendered: carried })).toEqual([])
    expect(renderedRouteProblems({ ...LIVE, routes: amp })).toEqual([
      expect.stringContaining('the rendered page does not carry the card route from its declaration (CARD_LINK)')
    ])
  })

  it('names the hand-written page whose nav loses the price page link', () => {
    const drifted = LIVE.pages.map(page =>
      page.file === 'reliability.html'
        ? { ...page, text: page.text.replace('        <a href="./pricing.html">Pricing</a>\n', '') }
        : page
    )
    expect(navProblems({ ...LIVE, pages: drifted })).toEqual([
      expect.stringContaining("website/reliability.html's primary nav carries no link to website/pricing.html")
    ])
  })

  it('names the NAV list a generated page would lose the link from', () => {
    const without = LIVE.nav.filter(([href]) => href !== 'pricing.html')
    expect(navProblems({ ...LIVE, nav: without })).toEqual([
      expect.stringContaining("NAV carries no ['pricing.html', 'Pricing'] entry")
    ])
  })

  it('names the site that serves no price page at all', () => {
    const without = LIVE.pages.filter(page => page.file !== 'pricing.html')
    expect(navProblems({ ...LIVE, pages: without })).toEqual([
      expect.stringContaining('website/pricing.html is not among the pages the site serves')
    ])
  })
})

/**
 * The guard reads the money record, and a record it cannot read is a failure rather than an
 * empty pass: prices compared against nothing is the vacuous run the record exists to prevent.
 */
describe('the record the guard reads', () => {
  it('fails loudly when the record is not at the path it names', () => {
    expect(() => readRecord(`${recordPath}.moved`)).toThrow('the money record could not be read at')
  })

  it('fails loudly on a record whose adopted model is not there', () => {
    expect(() => adoptedModel('# nothing to read here')).toThrow(
      "carries no '## Adopted model (decision D2)' section"
    )
    expect(() => adoptedModel('## Adopted model (decision D2)\n\nthe model moved to another file\n')).toThrow(
      'carries no bullets'
    )
  })

  it('fails loudly on a model it cannot find the judgement in', () => {
    expect(() => pricedBullets('## Adopted model (decision D2)\n\n- **$249 perpetual**\n')).toThrow(
      'must find exactly one to skip'
    )
  })

  it('reads a wrapped bullet as one price, and a comparison as no price at all', () => {
    const wrapped = [
      '## Adopted model (decision D2)',
      '',
      "- **$249 perpetual**, 12 months of updates, two machines — between SCS's top tier",
      "  and ATTACCA Pro, ~40% of QLab's entry.",
      '- $249 is a judgement, not a derivation; $199–299 is defensible.'
    ].join('\n')
    expect(pricedBullets(wrapped)).toEqual([
      "**$249 perpetual**, 12 months of updates, two machines — between SCS's top tier and ATTACCA Pro, ~40% of QLab's entry."
    ])
    expect(figuresIn("~40% of QLab's entry").map(figure => figure.text)).toEqual([])
  })

  it('reads a price unit as part of the price rather than as a term', () => {
    const bullets = pricedBullets(readRecord())
    const rental = bullets.find(bullet => bullet.includes('$12/day'))
    expect(rental, 'the record no longer states the rental price').toBeDefined()
    expect(termsIn(rental ?? '')).toEqual([])
    expect(termsIn('12 months of updates, two machines')).toEqual([
      { unit: 'month', count: 12 },
      { unit: 'machine', count: 2 }
    ])
  })
})
