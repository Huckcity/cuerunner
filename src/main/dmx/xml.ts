// A small XML reader, bounded, for the documents a fixture library hands us: elements and their
// attributes, which is all a GDTF `description.xml` says anything with.
//
// Written here rather than taken from a package because what it must refuse matters more than
// what it accepts. A document type declaration is refused outright — that is where an XML file
// defines entities, and an entity is how a few kilobytes expand into gigabytes or reach for a
// file on this machine — and only the five entities XML itself predefines, plus numeric
// character references, are ever expanded. Every list the reader builds is bounded before it
// grows: the characters read, the elements made, how deep they nest, how many attributes one
// carries and how long a value is. Text between elements is skipped, because nothing a fixture
// description says lives there; comments, processing instructions and CDATA are stepped over.
//
// Every refusal is a sentence about the file, thrown as a `Refusal`.

import { Refusal } from '../ipc/refusal'

export interface XmlElement {
  name: string
  attributes: Record<string, string>
  children: XmlElement[]
}

export interface XmlLimits {
  /** Characters of document read. */
  chars: number
  elements: number
  depth: number
  attributesPerElement: number
  /** Characters of one attribute value, after its references are expanded. */
  valueChars: number
}

export const XML_LIMITS: XmlLimits = {
  chars: 16 * 1024 * 1024,
  elements: 250_000,
  depth: 64,
  attributesPerElement: 64,
  valueChars: 64 * 1024
}

const NAME_START = /[A-Za-z_:À-￿]/
const NAME_CHAR = /[A-Za-z0-9_:.\-·À-￿]/

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }

/** An attribute value with its references expanded: the five XML predefines and numeric ones. */
function expand(raw: string, at: number): string {
  if (!raw.includes('&')) return raw
  return raw.replace(/&(#x[0-9A-Fa-f]{1,6}|#[0-9]{1,7}|[A-Za-z][A-Za-z0-9]*);?/g, (match, reference: string) => {
    if (!match.endsWith(';')) throw new Refusal(`its XML has an unfinished reference near character ${at}`)
    if (reference.startsWith('#')) {
      const code = reference.startsWith('#x') ? parseInt(reference.slice(2), 16) : parseInt(reference.slice(1), 10)
      if (!Number.isFinite(code) || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff) || code === 0) {
        throw new Refusal(`its XML names a character that does not exist near character ${at}`)
      }
      return String.fromCodePoint(code)
    }
    const known = ENTITIES[reference]
    if (known === undefined) {
      throw new Refusal(`its XML uses an entity it does not define (&${reference};), which is not read`)
    }
    return known
  })
}

/**
 * The document's root element, with every element under it. Refuses anything that is not one
 * well-formed element tree within the limits.
 */
export function parseXml(text: string, limits: XmlLimits = XML_LIMITS): XmlElement {
  if (text.length > limits.chars) {
    throw new Refusal(`its XML is longer than the ${Math.round(limits.chars / (1024 * 1024))} MB this app reads`)
  }
  let at = text.charCodeAt(0) === 0xfeff ? 1 : 0
  const stack: XmlElement[] = []
  let root: XmlElement | null = null
  let count = 0

  function fail(what: string): never {
    throw new Refusal(`its XML is damaged: ${what} near character ${at}`)
  }

  const readName = (): string => {
    const start = at
    if (at >= text.length || !NAME_START.test(text[at])) fail('a name was expected')
    at++
    while (at < text.length && NAME_CHAR.test(text[at])) at++
    return text.slice(start, at)
  }

  const skipSpace = (): void => {
    while (at < text.length && (text[at] === ' ' || text[at] === '\n' || text[at] === '\r' || text[at] === '\t')) at++
  }

  const skipPast = (marker: string, what: string): void => {
    const end = text.indexOf(marker, at)
    if (end === -1) fail(`${what} that never ends`)
    at = end + marker.length
  }

  while (at < text.length) {
    const lt = text.indexOf('<', at)
    if (lt === -1) {
      // Text after the root, or a document with no element at all.
      if (text.slice(at).trim() !== '' && root === null) fail('text where an element was expected')
      at = text.length
      break
    }
    if (stack.length === 0 && root === null && text.slice(at, lt).trim() !== '') fail('text before the first element')
    at = lt
    if (text.startsWith('<?', at)) {
      skipPast('?>', 'a processing instruction')
      continue
    }
    if (text.startsWith('<!--', at)) {
      skipPast('-->', 'a comment')
      continue
    }
    if (text.startsWith('<![CDATA[', at)) {
      if (stack.length === 0) fail('character data outside every element')
      skipPast(']]>', 'a CDATA section')
      continue
    }
    if (text.startsWith('<!', at)) {
      // <!DOCTYPE …>: where entities are declared, and so where expansion attacks live.
      throw new Refusal('its XML carries a document type declaration, which is not read')
    }
    if (text.startsWith('</', at)) {
      at += 2
      const name = readName()
      skipSpace()
      if (text[at] !== '>') fail(`the closing tag of ${name} is not closed`)
      at++
      const open = stack.pop()
      if (open === undefined || open.name !== name) fail(`</${name}> closes ${open === undefined ? 'nothing' : `<${open.name}>`}`)
      continue
    }
    // An opening tag.
    at++
    const name = readName()
    const element: XmlElement = { name, attributes: {}, children: [] }
    let attributes = 0
    let selfClosing = false
    for (;;) {
      const before = at
      skipSpace()
      if (at >= text.length) fail(`the tag <${name}> never ends`)
      if (text[at] === '>') {
        at++
        break
      }
      if (text.startsWith('/>', at)) {
        at += 2
        selfClosing = true
        break
      }
      if (at === before) fail(`<${name}> runs its attributes together`)
      const attribute = readName()
      skipSpace()
      if (text[at] !== '=') fail(`the attribute ${attribute} of <${name}> has no value`)
      at++
      skipSpace()
      const quote = text[at]
      if (quote !== '"' && quote !== "'") fail(`the attribute ${attribute} of <${name}> is not quoted`)
      const end = text.indexOf(quote, at + 1)
      if (end === -1) fail(`the attribute ${attribute} of <${name}> is never closed`)
      const raw = text.slice(at + 1, end)
      if (raw.includes('<')) fail(`the attribute ${attribute} of <${name}> holds a <`)
      if (raw.length > limits.valueChars) {
        throw new Refusal(`its XML has an attribute longer than the ${limits.valueChars} characters this app reads`)
      }
      const value = expand(raw, at)
      at = end + 1
      if (Object.prototype.hasOwnProperty.call(element.attributes, attribute)) {
        fail(`<${name}> carries ${attribute} twice`)
      }
      attributes++
      if (attributes > limits.attributesPerElement) {
        throw new Refusal(`its XML has an element with more than ${limits.attributesPerElement} attributes`)
      }
      element.attributes[attribute] = value
    }
    count++
    if (count > limits.elements) {
      throw new Refusal(`its XML has more than ${limits.elements} elements, more than this app reads`)
    }
    const parent = stack[stack.length - 1]
    if (parent === undefined) {
      if (root !== null) fail('a second root element')
      root = element
    } else {
      parent.children.push(element)
    }
    if (!selfClosing) {
      stack.push(element)
      if (stack.length > limits.depth) {
        throw new Refusal(`its XML nests deeper than the ${limits.depth} levels this app reads`)
      }
    }
  }
  if (stack.length > 0) fail(`<${stack[stack.length - 1].name}> is never closed`)
  if (root === null) throw new Refusal('it holds no XML element at all')
  return root
}

/** The children of an element with a name. */
export function childrenNamed(element: XmlElement, name: string): XmlElement[] {
  return element.children.filter(child => child.name === name)
}

/** The first child of an element with a name, or null. */
export function childNamed(element: XmlElement, name: string): XmlElement | null {
  return element.children.find(child => child.name === name) ?? null
}
