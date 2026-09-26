// The site stylesheet's mark and its print contract, held as the declarations they are made of.
//
// `website/styles.css` is what makes `.table-wrap` and `.code` say something about an edge the
// reader cannot see: a cover band that scrolls with the content (`background-attachment: local`)
// over a shadow band pinned to the box (`scroll`), so a shadow shows exactly while content sits
// beyond that edge and none once the box fits. It is CSS only — no listener, no markup — and until
// this file nothing read it: the four declarations that make a mark can lose a layer, a colour, a
// position or their order and every test stays green, as can the print block that drops the fixed
// table width and the bands a printed page cannot swipe.
//
// It reads the stylesheet as text, the way `scripts/theme.test.ts` reads `src/renderer/src/App.css`
// — no CSS parser is a declared dependency — and reads the rules itself: comments skipped where
// they stand, then the blocks a stylesheet is made of, each with the media query it sits under. A
// block whose selector starts with `@` is a context for the rules inside it rather than a rule,
// which is how the print block and its own narrow-column query are read, and a declaration quoted
// in a comment is prose rather than a rule.
//
// What it holds: the declarations. That both scroll containers keep the four bands in the order
// that marks an edge — each cover on the side it covers, each band fading inwards, each cover
// painted in the colour the box sits on and wider than the shadow under it, each shadow a band of
// a size; that no third box scrolls a page sideways unmarked; that a sample keeps its lines on
// screen and wraps in print; that the print block turns both bands off, drops the table's fixed
// width, breaks a printed table's cells in every column up to the widest table the site prints,
// and keeps a printed sample's long words inside its column. Numbers and colours are compared as
// what they are rather than as spellings (`0` and `0px`, `#fff` and `#FFFFFF` and `white`).
//
// What it cannot do is weigh a rule it does not read: a rule that reaches one of these elements and
// writes one of these properties — `.panel table { min-width: 560px }` beats the print block's
// `table { min-width: 0 }` however the source is ordered — is refused by name rather than passed
// over, and the pixels are measured in a browser, which is this change's acceptance evidence rather
// than this guard's.
//
// Each check is a function of the stylesheet, so the cases below hand it a mutated copy — a cover
// removed, repainted, pinned to the wrong edge or faded the wrong way, swapped with its shadow,
// tiled, sized away, a declaration moved out of the print block — and get the failure back by name.
// The cases rewrite a rule by the property it declares rather than quoting a copy of its text: a
// copy stops changing anything the moment the rule it was copied from is edited.
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

/** The stylesheet this guard reads, named in the failures: it is the file to edit. */
const STYLESHEET = 'website/styles.css'

/**
 * The widest table the site prints: `website/reliability.html`'s eight-column one, whose own words
 * need 566 px of column — its min-content, measured in Chromium (2026-09-22) at a 380 px viewport.
 */
const WIDEST_PRINTED_TABLE = 566

/**
 * And the page box that column needs: a print query matches the page box, not the column — the
 * column is the page box less the 40 px the panel's padding and the two borders spend — so the
 * stylesheet has to break a table's cells in every page box up to this width. Measured: at a
 * 566 px query (the column figure) a 570–600 px page box laid the table out at 566 px and clipped
 * a cell; from 606 px it fits. Paper is wider than this and prints a table as it always did.
 */
const PRINTED_PAGE_BOX = WIDEST_PRINTED_TABLE + 40

/** One rule of the stylesheet, as the guard reads it. */
interface Rule {
  /** The selector as written, trimmed; a list (`th, td`) is one rule. */
  selector: string
  /** Its declarations, as written. */
  body: string
  /** The media query it sits under, without the `@media`, or null at the top level. */
  media: string | null
  /** Where the rule's declarations begin and end in the stylesheet, so a case can rewrite one. */
  from: number
  to: number
}

/** One declaration of a rule: the property it writes and the value it writes for it. */
interface Declaration {
  property: string
  value: string
}

/** What a check reads: the stylesheet as text, and the rules it is made of. */
interface Reading {
  css: string
  rules: Rule[]
}

/** One held declaration: the element it is read on, the properties it is made of, and where. */
interface Held {
  selector: string
  properties: string[]
  /** The media query the guard reads it under: null is the top level, `print` a print query. */
  media: string | null
}

/** Reads the stylesheet: an absent file is a failure, never a skip. */
function readStyles(): string {
  try {
    return fs.readFileSync(path.join(root, STYLESHEET), 'utf-8')
  } catch (cause) {
    throw new Error(
      `the site stylesheet's mark and print contract: ${STYLESHEET} cannot be read — ${(cause as Error).message}: a rule held against an unread stylesheet is held to nothing`
    )
  }
}

/**
 * The stylesheet with its comments blanked out — the same text, with every comment's characters
 * turned into spaces — so a declaration quoted in a comment is not read as one while every offset
 * still points at the text as written.
 */
function uncommented(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, comment => comment.replace(/[^\n]/g, ' '))
}

/**
 * Every rule the stylesheet declares, each with the media query it sits under and the span its
 * declarations occupy — offsets into the text the caller passed, which is what lets a case rewrite
 * one declaration of one rule rather than a copy of its text. A block whose selector starts with
 * `@` is the context of the blocks inside it.
 */
function rulesIn(css: string): Rule[] {
  const text = uncommented(css)
  const rules: Rule[] = []
  /** The blocks the reader is inside: what opened each, and the media query around it. */
  const open: Array<{ selector: string; media: string | null }> = []
  /** Where each open block's declarations begin, in the order the blocks were opened. */
  const bodies: number[] = []
  let head = ''
  let body = ''
  for (let at = 0; at < text.length; at += 1) {
    const character = text[at]
    if (character === '{') {
      const selector = head.trim()
      const around = open.length === 0 ? null : open[open.length - 1].media
      open.push({ selector, media: selector.startsWith('@') ? selector.replace(/^@[a-z-]+\s*/, '') : around })
      bodies.push(at + 1)
      head = ''
      body = ''
      continue
    }
    if (character === '}') {
      const block = open.pop()
      const from = bodies.pop() ?? at
      if (block !== undefined && !block.selector.startsWith('@')) {
        // The body is kept as written — its offsets are what a case rewrites — so it is not trimmed.
        rules.push({ selector: block.selector, body, media: block.media, from, to: at })
      }
      head = ''
      body = ''
      continue
    }
    if (open.length > 0 && !open[open.length - 1].selector.startsWith('@')) body += character
    else head += character
  }
  if (rules.length === 0) {
    throw new Error(`${STYLESHEET} holds no rule this guard can read, so a pass here would mean nothing`)
  }
  return rules
}

/** The stylesheet as the guard reads it. */
function readingOf(css: string): Reading {
  return { css, rules: rulesIn(css) }
}

/** A rule's declarations, in the order it writes them. */
function declarationsOf(rule: Rule): Declaration[] {
  return [...rule.body.matchAll(/([\w-]+)\s*:\s*([^;]+)/g)].map(found => ({
    property: found[1].trim(),
    value: found[2].trim()
  }))
}

/**
 * The rules that declare a selector, under a media query: null reads the top level, which is what
 * the site serves, and `print` reads the rules inside a print query.
 */
function rulesFor(reading: Reading, selector: string, media: string | null): Rule[] {
  return reading.rules.filter(rule => {
    const printable = rule.media !== null && rule.media.startsWith('print')
    const under = media === null ? rule.media === null : printable
    return under && rule.selector.split(',').map(part => part.trim()).includes(selector)
  })
}

/** One declaration's value, read from the rules that write it: the last one, as CSS reads them. */
function declarationIn(reading: Reading, selector: string, property: string, media: string | null): string | null {
  let value: string | null = null
  for (const rule of rulesFor(reading, selector, media)) {
    const written = declarationsOf(rule)
      .filter(declaration => declaration.property === property)
      .pop()
    if (written !== undefined) value = written.value
  }
  return value
}

/** The layers of a value: its comma-separated parts, split where the commas are not in brackets. */
function layersOf(value: string): string[] {
  const layers: string[] = []
  let depth = 0
  let layer = ''
  for (const character of value) {
    if (character === '(') depth += 1
    if (character === ')') depth -= 1
    if (character === ',' && depth === 0) {
      layers.push(layer.trim())
      layer = ''
      continue
    }
    layer += character
  }
  layers.push(layer.trim())
  return layers.filter(part => part !== '')
}

/** The colours a name stands for, which are the same colour as their hex — and `none`, which is
 *  the same background as `transparent` and the spelling the print guard itself recommends. */
const NAMED_COLOURS: Record<string, string> = {
  white: '#ffffff',
  black: '#000000',
  transparent: 'transparent',
  none: 'transparent'
}

/**
 * A colour as the one string it is: `#fff`, `#FFFFFF`, `white` and `rgb(255, 255, 255)` are the same
 * colour, and what the guard cannot compute — `var(--bg-raised)`, `color-mix(...)`, `rgba(...)` — is
 * read as the token the stylesheet names, with its spacing closed. Null for a value that is not a
 * colour at all.
 */
function colourIn(value: string): string | null {
  const colour = value.trim().toLowerCase()
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(colour)
  if (hex !== null) {
    return `#${hex[1].length === 3 ? [...hex[1]].map(digit => digit + digit).join('') : hex[1]}`
  }
  const rgb = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/.exec(colour)
  if (rgb !== null) {
    return `#${[1, 2, 3].map(index => Number(rgb[index]).toString(16).padStart(2, '0')).join('')}`
  }
  return NAMED_COLOURS[colour] ?? (/^[a-z-]+\(/.test(colour) ? colour.replace(/\s+/g, ' ') : null)
}

/** A length as a number of pixels: `0`, `0px` and `0.0px` are the same length, and no unit is px. */
function pixelsIn(value: string): number | null {
  const found = /^(-?[\d.]+)(px)?$/.exec(value.trim().toLowerCase())
  return found === null ? null : Number(found[1])
}

/** A layer's colour: its own token, with the size a band may carry taken off the end. */
function colourOfLayer(layer: string): string | null {
  return colourIn(layer.replace(/\s+[\d.]+(px|%)?$/, '').trim())
}

/** The background colour a box paints, from its own rules: null where it paints none this can read. */
function paintedIn(reading: Reading, selector: string, media: string | null): string | null {
  const value =
    declarationIn(reading, selector, 'background-color', media) ?? declarationIn(reading, selector, 'background', media)
  if (value === null) return null
  const layers = layersOf(value)
  const last = layers[layers.length - 1]
  return /gradient\(|url\(|image\(/.test(last) ? null : colourOfLayer(last)
}

/** The background layers a box paints, as the gradients they are: the covers and the shadows. */
function bandsIn(reading: Reading, selector: string, media: string | null): string[] {
  const value =
    declarationIn(reading, selector, 'background-image', media) ?? declarationIn(reading, selector, 'background', media)
  return value === null ? [] : layersOf(value).filter(layer => /gradient\(|url\(|image\(/.test(layer))
}

/** The parts of a band's gradient: its direction first, then the colour and the fade it paints. */
function gradientOf(band: string): string[] | null {
  const painted = /^[a-z-]*gradient\(([\s\S]*)\)[^)]*$/.exec(band.trim())
  return painted === null ? null : layersOf(painted[1])
}

/** The colour a band paints: the colour of the gradient that makes it. */
function bandColour(band: string): string | null {
  const parts = gradientOf(band)
  return parts === null || parts.length < 2 ? null : colourOfLayer(parts[1])
}

/** The edge a band is pinned to and the way it fades, both as the layer writes them. */
function bandGeometry(band: string): { position: string; fade: string } | null {
  const parts = gradientOf(band)
  if (parts === null) return null
  const position = (band.trim().slice(band.trim().lastIndexOf(')') + 1) || '').trim().replace(/\s+/g, ' ')
  return { position, fade: parts[0].trim().replace(/\s+/g, ' ') }
}

/** The site's two scroll containers, and what each is painted in. */
const SCROLL_BOXES = [
  // The table's wrapper is transparent inside a panel, so its covers are the panel's own surface;
  // the code box paints its own background, so its covers are that colour. A cover in another
  // colour shows its band against a different one, which is the regression this check is here for.
  { selector: '.table-wrap', paintedBy: '.panel' },
  { selector: '.code', paintedBy: '.code' }
]

/**
 * The bands a mark is made of, in order: the cover and the shadow at each edge, each pinned to the
 * edge it marks and each fading inwards — `to right` from the left edge, `to left` from the right —
 * because a band that fades outwards paints its strongest colour at the page's edge and none at the
 * content's.
 */
const BANDS = [
  { position: 'left center', fade: 'to right' },
  { position: 'right center', fade: 'to left' },
  { position: 'left center', fade: 'to right' },
  { position: 'right center', fade: 'to left' }
]

/** The background properties a box's mark is made of, which is what a competing rule would strike. */
const BACKGROUNDS = [
  'background',
  'background-image',
  'background-color',
  'background-attachment',
  'background-repeat',
  'background-size',
  'background-position'
]

/**
 * Every declaration this guard reads, by the element it is read on and the context it is read in.
 * The list is also what a rule the guard cannot weigh is measured against: a rule that reaches one
 * of these elements and writes one of these properties is refused by name.
 */
const HELD: Held[] = [
  { selector: '.table-wrap', properties: ['overflow-x', ...BACKGROUNDS], media: null },
  { selector: '.code', properties: ['overflow-x', 'white-space', ...BACKGROUNDS], media: null },
  { selector: '.code', properties: ['white-space', 'overflow-wrap', ...BACKGROUNDS], media: 'print' },
  { selector: 'table', properties: ['min-width'], media: 'print' },
  { selector: 'th', properties: ['overflow-wrap'], media: 'print' },
  { selector: 'td', properties: ['overflow-wrap'], media: 'print' }
]

/**
 * Both scroll containers' marks, held to the declarations that make one: a box that scrolls
 * horizontally, four bands in the order that marks each edge — the two covers first, under `local`
 * so they travel with the content, then the two shadows under `scroll` so they stay pinned to the
 * box — each on the edge it marks and fading inwards, each cover painted in what the box sits on
 * and wider than the shadow under it, no band tiled, and each shadow a band of a size rather than
 * nothing.
 */
function markProblems(reading: Reading): string[] {
  return SCROLL_BOXES.flatMap(box => {
    const problems: string[] = []
    const scroll = (declarationIn(reading, box.selector, 'overflow-x', null) ?? 'nothing').toLowerCase()
    if (scroll !== 'auto') {
      problems.push(
        `${STYLESHEET}'s ${box.selector} reads overflow-x: ${scroll}, and the mark is about a box that scrolls: \`${box.selector} { overflow-x: auto }\``
      )
    }
    const bands = bandsIn(reading, box.selector, null)
    if (bands.length !== 4) {
      problems.push(
        `${STYLESHEET}'s ${box.selector} paints ${bands.length} background layers, and the mark is four: a cover and a shadow at each edge`
      )
      return problems
    }
    const attachments = layersOf(declarationIn(reading, box.selector, 'background-attachment', null) ?? '').map(part =>
      part.toLowerCase()
    )
    if (attachments.length !== 4 || attachments.some((part, index) => part !== (index < 2 ? 'local' : 'scroll'))) {
      problems.push(
        `${STYLESHEET}'s ${box.selector} carries background-attachment: ${attachments.join(', ') || 'nothing'}, and the mark needs its covers to travel with the content and its shadows to stay pinned: \`local, local, scroll, scroll\``
      )
      return problems
    }
    const geometry = bands.map(bandGeometry)
    geometry.forEach((band, index) => {
      if (band === null) {
        problems.push(`${STYLESHEET}'s ${box.selector} carries a band this guard cannot read: ${bands[index]}`)
        return
      }
      if (band.position !== BANDS[index].position) {
        problems.push(
          `${STYLESHEET}'s ${box.selector} pins band ${index + 1} to "${band.position || 'no edge'}", and band ${index + 1} is the ${index < 2 ? 'cover' : 'shadow'} of the ${BANDS[index].position.split(' ')[0]} edge: \`${BANDS[index].position}\``
        )
      }
      if (band.fade !== BANDS[index].fade) {
        problems.push(
          `${STYLESHEET}'s ${box.selector} fades band ${index + 1} "${band.fade}", and a band at the ${BANDS[index].position.split(' ')[0]} edge fades inwards: \`${BANDS[index].fade}\``
        )
      }
    })
    const repeats = layersOf(declarationIn(reading, box.selector, 'background-repeat', null) ?? '').map(part =>
      part.toLowerCase()
    )
    if (!(repeats.length === 1 || repeats.length === 4) || repeats.some(part => part !== 'no-repeat')) {
      problems.push(
        `${STYLESHEET}'s ${box.selector} repeats its bands (background-repeat: ${repeats.join(', ') || 'nothing'}), and a mark tiled across the box is not an edge`
      )
    }
    const size = declarationIn(reading, box.selector, 'background-size', null)
    const widths = layersOf(size ?? '')
      .map(part => pixelsIn(part.split(/\s+/)[0]))
      .filter((width): width is number => width !== null)
    if (widths.length !== 4) {
      problems.push(
        `${STYLESHEET}'s ${box.selector} sizes its bands with background-size: ${size ?? 'nothing'}, and the mark is four widths — a cover and a shadow at each edge`
      )
      return problems
    }
    if (!(widths[0] > widths[2]) || !(widths[1] > widths[3])) {
      problems.push(
        `${STYLESHEET}'s ${box.selector} lays its covers at ${widths[0]} and ${widths[1]} px over shadows of ${widths[2]} and ${widths[3]} px, and a cover has to be wider than the shadow under it`
      )
    }
    if (!(widths[2] > 0) || !(widths[3] > 0)) {
      problems.push(
        `${STYLESHEET}'s ${box.selector} lays its shadows at ${widths[2]} and ${widths[3]} px, and a shadow of nothing shows nothing however the cover scrolls`
      )
    }
    const on = paintedIn(reading, box.paintedBy, null)
    const colours = bands.map(bandColour)
    if (on === null || colours.some(colour => colour === null)) {
      problems.push(
        `${STYLESHEET}'s ${box.selector} paints a band this guard cannot read — ${colours.join(', ')} over ${on ?? `${box.paintedBy} with no colour`}: the covers and the shadows are read as the colours they name`
      )
      return problems
    }
    if (colours[0] !== on || colours[1] !== on) {
      problems.push(
        `${STYLESHEET}'s ${box.selector} paints its covers in ${colours[0]} and ${colours[1]}, and the box sits on ${on} (${box.paintedBy}): a cover in another colour covers nothing`
      )
    }
    if (colours[2] === on || colours[3] === on || colours[2] !== colours[3]) {
      problems.push(
        `${STYLESHEET}'s ${box.selector} paints its shadows in ${colours[2]} and ${colours[3]}, and the shadow is the band a reader sees where the content runs past the edge: ${on} and two different colours both fail to be one`
      )
    }
    return problems
  })
}

/** The boxes the stylesheet may clip or scroll without the guard holding a mark on them. */
const NOT_A_SCROLL_BOX: Record<string, string> = {
  body: "the document's own guard against a page that scrolls sideways"
}

/**
 * Every box that scrolls sideways, and every box that clips what runs past its edge: the site's
 * promise is that content hidden past an edge is marked, so a third scroll container — or a box
 * that clips quietly — is a page a reader cannot finish. A box the guard holds is the mark's, and
 * the document's own guard is named for what it is rather than mistaken for a content box.
 */
function scrollBoxProblems(reading: Reading): string[] {
  const held = SCROLL_BOXES.map(box => box.selector)
  const problems: string[] = []
  for (const rule of reading.rules) {
    const selectors = rule.selector.split(',').map(part => part.trim())
    for (const declaration of declarationsOf(rule).filter(entry => entry.property === 'overflow-x')) {
      const value = declaration.value.toLowerCase()
      if (selectors.some(selector => held.includes(selector))) continue
      if (value === 'visible') continue
      if (selectors.every(selector => NOT_A_SCROLL_BOX[selector] === undefined)) {
        const clips = value !== 'auto' && value !== 'scroll' && value !== 'overlay'
        problems.push(
          clips
            ? `${STYLESHEET}'s ${rule.selector} clips what runs past its edge (overflow-x: ${value}) and carries no mark: name it beside ${held.join(' and ')} as a box a reader does not scroll, or give it the mark`
            : `${STYLESHEET}'s ${rule.selector} scrolls sideways (overflow-x: ${value}) and carries no mark: ${held.join(' and ')} are the boxes this guard holds, and a third scroll container is a page whose content hides past an edge with nothing saying so`
        )
      }
    }
  }
  return problems
}

/** The parts of a selector: the tokens of its last compound, which is the element it matches. */
function subjectOf(selector: string): { tags: string[]; classes: string[]; ids: string[] } {
  const subject = selector.split(/\s*[>+~]\s*|\s+/).pop() ?? ''
  return {
    tags: [...subject.matchAll(/(^|[^.#[:])([a-z][\w-]*)/gi)].map(found => found[2].toLowerCase()),
    classes: [...subject.matchAll(/\.([\w-]+)/g)].map(found => found[1]),
    ids: [...subject.matchAll(/#([\w-]+)/g)].map(found => found[1])
  }
}

/** Whether a rule's selector could be about the element another selector names. */
function couldMatch(candidate: string, element: string): boolean {
  const one = subjectOf(candidate)
  const other = subjectOf(element)
  const apart = (a: string[], b: string[]): boolean =>
    a.length === 0 || b.length === 0 ? a.length === b.length : a.some(token => b.includes(token))
  // An element is matched by both only where neither asks for a tag, a class or an id the other
  // does not: a compound's own tokens are the ones that decide, and a token on one side alone makes
  // the two selectors about different elements.
  return apart(one.tags, other.tags) && apart(one.classes, other.classes) && apart(one.ids, other.ids)
}

/**
 * The rules this guard cannot weigh, refused by name: a rule that reaches one of the elements it
 * holds, writes one of the properties it holds, and is not the rule it reads — a different selector
 * that matches the same element (`table { min-width: 0 }` in the print block loses to a
 * `.panel table { min-width: 560px }` wherever that is written), or the same selector written after
 * the rule the guard reads, which the cascade gives the last word to. What the site serves would be
 * that declaration, so the guard says so rather than passing on a rule it never read.
 */
function unweighedProblems(reading: Reading): string[] {
  const problems: string[] = []
  for (const held of HELD) {
    const own = rulesFor(reading, held.selector, held.media)
    const read = own[own.length - 1]
    if (read === undefined) continue
    for (const rule of reading.rules) {
      if (rule === read) continue
      const written = held.properties.filter(property =>
        declarationsOf(rule).some(declaration => declaration.property === property)
      )
      if (written.length === 0) continue
      // A rule in a context the guard's own does not share cannot strike it: a print rule leaves
      // what the site serves on screen alone, while the top level prints too.
      const competes = rule.media === null || (held.media !== null && rule.media.startsWith('print'))
      if (!competes) continue
      rule.selector
        .split(',')
        .map(part => part.trim())
        .forEach(selector => {
          if (selector !== held.selector && !couldMatch(selector, held.selector)) return
          // The same selector written before the rule the guard reads is the premise that rule
          // overrides; written after it, the cascade gives it the last word.
          if (selector === held.selector && rule.from < read.from) return
          const message =
            `${STYLESHEET}'s \`${selector}\` writes ${written.join(', ')} over \`${held.selector} { ${held.properties[0]} … }\`${
              held.media === null ? '' : ` in the print block`
            }: this guard cannot weigh that rule${
              selector === held.selector ? ' — it comes after the declaration the guard reads, so the cascade gives it the last word' : " — it reaches the same element by another selector, so what the site serves is that declaration"
            }`
          if (!problems.includes(message)) problems.push(message)
        })
    }
  }
  return problems
}

/**
 * A code sample's lines on screen and its wrapping on paper: `pre` keeps the lines the sample was
 * written in, which is what makes a line run past the edge at all, and a printed page — which
 * cannot be swiped — takes `pre-wrap`.
 */
function sampleProblems(reading: Reading): string[] {
  const problems: string[] = []
  const screen = (declarationIn(reading, '.code', 'white-space', null) ?? 'nothing').toLowerCase()
  if (screen !== 'pre') {
    problems.push(
      `${STYLESHEET}'s .code reads white-space: ${screen} on screen, and a sample is written in lines: \`.code { white-space: pre }\``
    )
  }
  const printed = (declarationIn(reading, '.code', 'white-space', 'print') ?? 'nothing').toLowerCase()
  if (printed !== 'pre-wrap') {
    problems.push(
      `${STYLESHEET}'s print block reads .code white-space: ${printed}, and a printed page cannot be swiped: \`.code { white-space: pre-wrap }\` there`
    )
  }
  return problems
}

/** The print queries that break a printed table's cells, and the column width each answers for. */
function cellBreaks(reading: Reading): number[] {
  const widths: number[] = []
  for (const rule of reading.rules) {
    if (rule.media === null || !rule.media.startsWith('print')) continue
    const query = /max-width:\s*([\d.]+)px/.exec(rule.media)
    if (query === null) continue
    const cells = rule.selector.split(',').map(part => part.trim())
    if (!['th', 'td'].every(cell => cells.includes(cell))) continue
    const wraps = declarationsOf(rule).find(declaration => declaration.property === 'overflow-wrap')
    if (wraps === undefined || wraps.value.toLowerCase() !== 'anywhere') continue
    widths.push(Number(query[1]))
  }
  return widths
}

/**
 * The print contract: a printed page cannot be swiped, so neither box paints a band, a code sample
 * prints white, keeps its column (a word too long for it breaks rather than running past the edge)
 * and wraps, a wide table loses the fixed width that would clip it, and the widest table the site
 * prints breaks in every page box narrow enough to clip it.
 */
function printProblems(reading: Reading): string[] {
  const problems: string[] = []
  for (const box of SCROLL_BOXES) {
    // A printed page cannot be swiped, so the box's own bands have to be turned off where it
    // prints: a print block that says nothing leaves the screen's four layers to print.
    const declared =
      declarationIn(reading, box.selector, 'background-image', 'print') ??
      declarationIn(reading, box.selector, 'background', 'print')
    const bands = bandsIn(reading, box.selector, 'print')
    if (declared === null) {
      problems.push(
        `${STYLESHEET}'s print block leaves ${box.selector} with the bands it paints on screen, and a printed page cannot be swiped: \`${box.selector} { background: none }\` there`
      )
    } else if (bands.length !== 0) {
      problems.push(
        `${STYLESHEET}'s print block leaves ${box.selector} with ${bands.length} background layers to print: the covers and the shadows are about a box that can be swiped, and a page cannot`
      )
    }
  }
  const sample = paintedIn(reading, '.code', 'print')
  if (sample !== '#ffffff' && sample !== 'transparent') {
    problems.push(
      `${STYLESHEET}'s print block paints .code ${sample ?? 'no colour this guard can read'}, and a printed sample is white: \`.code { background: #ffffff }\``
    )
  }
  const wraps = (declarationIn(reading, '.code', 'overflow-wrap', 'print') ?? 'nothing').toLowerCase()
  if (wraps !== 'anywhere') {
    problems.push(
      `${STYLESHEET}'s print block reads .code overflow-wrap: ${wraps}, and a printed line with a word longer than its column runs past the edge with no way to reach it: \`.code { overflow-wrap: anywhere }\` there`
    )
  }
  const width = declarationIn(reading, 'table', 'min-width', 'print')
  if (width === null) {
    problems.push(
      `${STYLESHEET}'s print block does not drop the table's fixed width, so a printed table is clipped by it: \`table { min-width: 0 }\` there`
    )
  } else if (pixelsIn(width) !== 0) {
    problems.push(
      `${STYLESHEET}'s print block prints tables at min-width: ${width}, and a printed column narrower than that clips them: \`table { min-width: 0 }\` there`
    )
  }
  const breaks = cellBreaks(reading)
  if (!breaks.some(column => column >= PRINTED_PAGE_BOX)) {
    problems.push(
      `${STYLESHEET} breaks a printed table's cells in page boxes up to ${
        breaks.length === 0 ? 'no width at all' : `${Math.max(...breaks)} px`
      }, and the widest table the site prints needs ${WIDEST_PRINTED_TABLE} px of column — a ${PRINTED_PAGE_BOX} px page box, the 40 px between being the panel's padding and the two borders (website/reliability.html, measured): \`@media print and (max-width: ${PRINTED_PAGE_BOX}px) { th, td { overflow-wrap: anywhere } }\` — a print query matches the page box, and \`anywhere\` rather than \`break-word\`, because only \`anywhere\` lowers the width a table is laid out at`
    )
  }
  return problems
}

/** The stylesheet as the tree holds it. */
const LIVE = readStyles()

describe('the site stylesheet', () => {
  it('marks both of the site’s scroll containers', () => {
    expect(markProblems(readingOf(LIVE))).toEqual([])
  })

  it('scrolls nothing sideways and clips nothing quietly but its own two boxes', () => {
    expect(scrollBoxProblems(readingOf(LIVE))).toEqual([])
  })

  it('keeps a sample’s lines on screen and wraps them in print', () => {
    expect(sampleProblems(readingOf(LIVE))).toEqual([])
  })

  it('prints a table that fits its column', () => {
    expect(printProblems(readingOf(LIVE))).toEqual([])
  })

  it('reads nothing it cannot weigh', () => {
    expect(unweighedProblems(readingOf(LIVE))).toEqual([])
  })

  it('reads the rules of a stylesheet, each under the query it sits in', () => {
    const rules = rulesIn(LIVE)
    expect(rules.some(rule => rule.selector === '.code' && rule.media === null)).toBe(true)
    expect(rules.some(rule => rule.selector === '.code' && rule.media === 'print')).toBe(true)
    expect(rules.some(rule => rule.media === `print and (max-width: ${PRINTED_PAGE_BOX}px)`)).toBe(true)
  })

  it('reads declarations rather than the sentences about them', () => {
    // A stylesheet whose only `.code` rule is a comment holds nothing: a declaration quoted in a
    // comment is a sentence about the stylesheet, and a guard that read it would pass on prose.
    expect(() => rulesIn('/* .code { white-space: pre } */')).toThrow(
      `${STYLESHEET} holds no rule this guard can read`
    )
    // And the offsets a rule reports point at the stylesheet itself, comments and all.
    const rules = rulesIn(`${LIVE.slice(0, 40)}/* a comment between rules */${LIVE.slice(40)}`)
    const code = rules.find(rule => rule.selector === '.code' && rule.media === null)
    expect(code).toBeDefined()
    expect(code?.from).toBeGreaterThan(0)
    expect((code?.to ?? 0)).toBeGreaterThan(code?.from ?? 0)
  })
})

describe('a stylesheet that drifts from the contract', () => {
  /** The stylesheet with one declaration of one rule rewritten, by selector and property. */
  function wrote(
    css: string,
    selector: string,
    property: string,
    rewrite: (value: string) => string,
    options: { media?: string | null; as?: string } = {}
  ): string {
    const media = options.media ?? null
    const rules = rulesFor(readingOf(css), selector, media)
    for (const rule of [...rules].reverse()) {
      const written = [...rule.body.matchAll(new RegExp(`${property}\\s*:\\s*([^;]*)`, 'g'))].pop()
      if (written === undefined) continue
      const at = rule.from + (written.index ?? 0)
      const value = rewrite(written[1].trim())
      const declaration = `${options.as ?? property}: ${value}`
      // An empty rewrite drops the declaration, which is how a case takes one out of a rule.
      const patched = value === '' ? '' : declaration
      return `${css.slice(0, at)}${patched}${css.slice(at + written[0].length)}`
    }
    throw new Error(`a case changed nothing in ${STYLESHEET}: \`${selector}\` declares no ${property}${media === null ? '' : ` under ${media}`}`)
  }

  it('names the box whose band was removed', () => {
    const thinner = wrote(LIVE, '.code', 'background', value =>
      layersOf(value)
        .filter((_, index) => index !== 0)
        .join(', ')
    )
    expect(markProblems(readingOf(thinner))).toEqual([
      expect.stringContaining(`${STYLESHEET}'s .code paints 3 background layers, and the mark is four`)
    ])
  })

  it('names the box whose cover is painted in another colour', () => {
    const repainted = wrote(LIVE, '.code', 'background', value => value.replace('var(--bg-raised)', 'var(--accent-amber)'))
    expect(markProblems(readingOf(repainted))).toEqual([
      expect.stringContaining(
        `${STYLESHEET}'s .code paints its covers in var(--accent-amber) and var(--bg-raised), and the box sits on var(--bg-raised) (.code)`
      )
    ])
  })

  it('names the box whose cover is pinned to the wrong edge', () => {
    const moved = wrote(LIVE, '.code', 'background', value => value.replace('to right, var(--bg-raised) 55%, transparent) left center', 'to right, var(--bg-raised) 55%, transparent) right center'))
    expect(markProblems(readingOf(moved))).toEqual([
      expect.stringContaining(`${STYLESHEET}'s .code pins band 1 to "right center", and band 1 is the cover of the left edge: \`left center\``)
    ])
  })

  it('names the box whose band fades the wrong way', () => {
    const backwards = wrote(LIVE, '.code', 'background', value => value.replace('linear-gradient(to left, var(--bg-raised)', 'linear-gradient(to right, var(--bg-raised)'))
    expect(markProblems(readingOf(backwards))).toEqual([
      expect.stringContaining(`${STYLESHEET}'s .code fades band 2 "to right", and a band at the right edge fades inwards: \`to left\``)
    ])
  })

  it('names the box whose covers and shadows were swapped', () => {
    const swapped = wrote(LIVE, '.code', 'background-attachment', value =>
      layersOf(value)
        .reverse()
        .join(', ')
    )
    expect(markProblems(readingOf(swapped))).toEqual([
      expect.stringContaining(
        `${STYLESHEET}'s .code carries background-attachment: scroll, scroll, local, local, and the mark needs its covers to travel with the content and its shadows to stay pinned`
      )
    ])
  })

  it('names the box whose cover is no wider than the shadow under it', () => {
    const reversed = wrote(LIVE, '.code', 'background-size', value => value.replace('48px', '12px'))
    expect(markProblems(readingOf(reversed))).toEqual([
      expect.stringContaining(`${STYLESHEET}'s .code lays its covers at 12 and 48 px over shadows of 18 and 18 px`)
    ])
  })

  it('names the box whose shadow is a band of nothing', () => {
    const gone = wrote(LIVE, '.code', 'background-size', value => value.replace(/18px/g, '0px'))
    expect(markProblems(readingOf(gone))).toEqual([
      expect.stringContaining(
        `${STYLESHEET}'s .code lays its shadows at 0 and 0 px, and a shadow of nothing shows nothing however the cover scrolls`
      )
    ])
  })

  it('names the box whose bands are tiled across it', () => {
    const tiled = wrote(LIVE, '.code', 'background-repeat', () => 'repeat')
    expect(markProblems(readingOf(tiled))).toEqual([
      expect.stringContaining(`${STYLESHEET}'s .code repeats its bands (background-repeat: repeat)`)
    ])
  })

  it('names a box that no longer scrolls', () => {
    const fixed = wrote(LIVE, '.code', 'overflow-x', () => 'hidden')
    expect(markProblems(readingOf(fixed))).toEqual([
      expect.stringContaining(`${STYLESHEET}'s .code reads overflow-x: hidden, and the mark is about a box that scrolls`)
    ])
  })

  it('names a third box that scrolls sideways with no mark on it', () => {
    const third = `${wrote(LIVE, '.code', 'overflow-x', () => 'auto')}\n.cheat-sheet {\n  overflow-x: auto;\n}\n`
    expect(scrollBoxProblems(readingOf(third))).toEqual([
      expect.stringContaining(`${STYLESHEET}'s .cheat-sheet scrolls sideways (overflow-x: auto) and carries no mark`)
    ])
  })

  it('names a box that clips what runs past its edge', () => {
    const clipped = `${LIVE}\n.crumbs {\n  overflow-x: clip;\n}\n`
    expect(scrollBoxProblems(readingOf(clipped))).toEqual([
      expect.stringContaining(`${STYLESHEET}'s .crumbs clips what runs past its edge (overflow-x: clip) and carries no mark`)
    ])
  })

  it('reads the document’s own guard as named rather than as a content box', () => {
    // `body { overflow-x: hidden }` is the page's own guard; the check names it where it stands, so
    // moving that guard onto a box a reader scrolls is what fails.
    const guarded = wrote(LIVE, 'body', 'overflow-x', () => 'hidden')
    expect(scrollBoxProblems(readingOf(guarded))).toEqual([])
    const moved = `${wrote(LIVE, 'body', 'overflow-x', () => 'visible')}\n.panel {\n  overflow-x: hidden;\n}\n`
    expect(scrollBoxProblems(readingOf(moved))).toEqual([
      expect.stringContaining(`${STYLESHEET}'s .panel clips what runs past its edge`)
    ])
  })

  it('refuses a rule it cannot weigh over a declaration it holds', () => {
    const compound = `${LIVE}\n@media print {\n  .panel table {\n    min-width: 560px;\n  }\n}\n`
    expect(unweighedProblems(readingOf(compound))).toEqual([
      expect.stringContaining(
        `${STYLESHEET}'s \`.panel table\` writes min-width over \`table { min-width … }\` in the print block: this guard cannot weigh that rule — it reaches the same element by another selector`
      )
    ])
    // The rule the guard reads is the print block's `table { min-width: 0 }`, and a top-level
    // `table { … }` written after it is the declaration print would take instead. Written in the
    // same context it would simply be the rule the guard reads, which is nothing to weigh.
    const later = `${LIVE}\ntable {\n  min-width: 0;\n}\n`
    expect(unweighedProblems(readingOf(later))).toEqual([
      expect.stringContaining(`${STYLESHEET}'s \`table\` writes min-width over \`table { min-width … }\` in the print block`)
    ])
    expect(unweighedProblems(readingOf(`${LIVE}\n@media print {\n  table {\n    min-width: 0;\n  }\n}\n`))).toEqual([])
  })

  it('names the sample rule that lost its lines', () => {
    const wrapped = wrote(LIVE, '.code', 'white-space', () => '')
    expect(sampleProblems(readingOf(wrapped))).toEqual([
      expect.stringContaining(`${STYLESHEET}'s .code reads white-space: nothing on screen, and a sample is written in lines`)
    ])
    // The sentence alone is not the declaration: a stylesheet that says `pre` in a comment keeps
    // none of its lines.
    const spoken = readingOf(`${wrapped}\n/* .code { white-space: pre } */\n`)
    expect(sampleProblems(spoken)).toEqual([
      expect.stringContaining(`${STYLESHEET}'s .code reads white-space: nothing on screen, and a sample is written in lines`)
    ])
  })

  it('names a printed sample that no longer wraps', () => {
    const moved = wrote(LIVE, '.code', 'white-space', () => '', { media: 'print' })
    expect(sampleProblems(readingOf(moved))).toEqual([
      expect.stringContaining(`${STYLESHEET}'s print block reads .code white-space: nothing, and a printed page cannot be swiped`)
    ])
  })

  it('names a printed sample whose long words would run past the column', () => {
    const unbroken = wrote(LIVE, '.code', 'overflow-wrap', () => '', { media: 'print' })
    expect(printProblems(readingOf(unbroken))).toEqual([
      expect.stringContaining(`${STYLESHEET}'s print block reads .code overflow-wrap: nothing`)
    ])
  })

  it('names a print block that leaves a band to print', () => {
    const kept = wrote(LIVE, '.table-wrap', 'background', () => '', { media: 'print' })
    expect(printProblems(readingOf(kept))).toEqual([
      expect.stringContaining(`${STYLESHEET}'s print block leaves .table-wrap with the bands it paints on screen`)
    ])
  })

  it('names a print block that keeps the table’s fixed width', () => {
    const kept = wrote(LIVE, 'table', 'min-width', () => '560px', { media: 'print' })
    expect(printProblems(readingOf(kept))).toEqual([
      expect.stringContaining(
        `${STYLESHEET}'s print block prints tables at min-width: 560px, and a printed column narrower than that clips them`
      )
    ])
  })

  it('names a print block that prints a sample in the site’s own dark', () => {
    const dark = wrote(LIVE, '.code', 'background', () => '#171a1f', { media: 'print' })
    expect(printProblems(readingOf(dark))).toEqual([
      expect.stringContaining(`${STYLESHEET}'s print block paints .code #171a1f, and a printed sample is white`)
    ])
  })

  it('names a print breakpoint under the page box the widest table needs', () => {
    const narrow = LIVE.replace(`max-width: ${PRINTED_PAGE_BOX}px`, `max-width: ${WIDEST_PRINTED_TABLE}px`)
    expect(printProblems(readingOf(narrow))).toEqual([
      expect.stringContaining(
        `${STYLESHEET} breaks a printed table's cells in page boxes up to ${WIDEST_PRINTED_TABLE} px, and the widest table the site prints needs ${WIDEST_PRINTED_TABLE} px of column — a ${PRINTED_PAGE_BOX} px page box`
      )
    ])
  })

  it('names a print breakpoint that does not break the cells it answers for', () => {
    const wordBreak = wrote(LIVE, 'td', 'overflow-wrap', () => 'break-word', { media: 'print' })
    expect(printProblems(readingOf(wordBreak))).toEqual([
      expect.stringContaining(`${STYLESHEET} breaks a printed table's cells in page boxes up to no width at all`)
    ])
  })

  it('names a print rule moved out of the print block', () => {
    // The declaration is still in the file, at a place nothing prints from: the check reads the
    // print block, not the stylesheet's text.
    const moved = `${wrote(LIVE, 'table', 'min-width', () => '', { media: 'print' })}\ntable {\n  min-width: 0;\n}\n`
    expect(printProblems(readingOf(moved))).toEqual([
      expect.stringContaining(`${STYLESHEET}'s print block does not drop the table's fixed width`)
    ])
  })

  it('reads an equivalent spelling of a print declaration as the declaration it is', () => {
    // `0px` is `0`, `#FFFFFF` is `#ffffff`, `background-image: none` is no image: a guard that
    // compared spellings would fail a stylesheet that says the same thing.
    const spelled = wrote(LIVE, '.table-wrap', 'background', () => 'none', { media: 'print', as: 'background-image' })
    const respelled = wrote(wrote(spelled, 'table', 'min-width', () => '0px', { media: 'print' }), '.code', 'background', () => '#FFFFFF', { media: 'print' })
    const printed = readingOf(respelled)
    expect(printProblems(printed)).toEqual([])
    expect(sampleProblems(printed)).toEqual([])
    expect(markProblems(printed)).toEqual([])
  })

  it('reads `background: none` as the transparent it is', () => {
    // `none` paints no background, the same thing as `transparent` and the spelling the guard
    // itself recommends for `.table-wrap` above: `.code` saying it prints the white sample.
    const none = wrote(LIVE, '.code', 'background', () => 'none', { media: 'print' })
    expect(printProblems(readingOf(none))).toEqual([])
  })
})
