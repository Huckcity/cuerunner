// The served pages' app words, held to the app.
//
// The site sends readers to the app's dialogs, tabs and menu items, and pages did so in words the
// app does not use: `website/reference/settings.html` printed "Cuerunner ▾ → Settings" and
// "Cuerunner ▾ → Show Settings" without the ellipsis `src/shared/fileMenu.ts` puts on those labels,
// `website/reference/keyboard.html` printed "Save As" and "Settings" the same way, and
// `website/redundancy.html` sent readers to a "Redundancy" tab the dialog labels "Backup machine".
// Nothing read any of it — the price page's sentence was the only one held to the app — so a page
// could keep pointing at a control that had moved, with every test green.
//
// It reads the served tree as text (`website/**/*.html`, the files `deploy-website.yml` uploads),
// the declarations in `website/docs/app-paths.mjs`, and the app's own sources: the brand and its
// caret (`Toolbar.tsx`), the File menu (`src/shared/fileMenu.ts`), the window's other menus
// (`src/main/index.ts`, where the Edit menu's Undo and Redo and the Playback menu's Panic are
// declared) and the two dialogs' tabs (`SettingsDialog.tsx`, `ShowSettings.tsx`). The label readers
// are the shape `scripts/pricing-page.test.ts` uses — a pattern over the file's text with its own
// line wrapping taken out, so a label reads as the operator meets it in the app — and each list is
// read with the count it declares, so an entry the reader cannot parse refuses rather than quietly
// leaving a label nothing is held to.
//
// What a page's words are: what a reader meets. Tags are gone — an inline element's tags sit
// between the letters of a word (`<kbd>Ctrl</kbd>/<kbd>⌘</kbd>`) — character references are decoded
// (`website/guides/showfile.html` writes its four caret paths as `&#9662;`, `&rarr;` and
// `&hellip;`), and the contents of `<script>`, `<style>` and HTML comments are left out: none of
// them is a word on the page. A table row is read only when its keys cell carries an accelerator
// one of the app's menus declares, so a prose cell that happens to equal a label is neither a row
// nor a way to silence one, and a row belongs to the item whose accelerator it prints rather than
// to any cell that equals a label.
//
// A path is read the way a reader follows one: from a head the site writes — the brand with its
// caret, or the dialog's own name — and then as the app's own names for its controls where the page
// starts one, up to three words where it starts something the app has no name for (which is how a
// page pointing at a control that has gone is read at all), and through the page's joining word
// where one segment names two controls (`Settings → Network or MIDI`). The words after that join
// belong to the path, so `Settings → Audio or License` is a longer path of its own rather than the
// declared `Settings → Audio` and a sentence, and it fails alone.
//
// What it holds, per path kind: a tab's name is the app's everywhere; a path under the brand caret
// and a keyboard row carry the menu item's label exactly, ellipsis included — unless the entry is
// `own`, a word that is the page's own, held to the page by the declaration while the row answers
// to the item by the keys it prints; a path that names a dialog in prose may print its name without
// the ellipsis (`Settings → Audio` stays as it is), so the guard holds those names rather than their
// punctuation; a label a page prints on its own is held to the app's word, with no head around it.
// A path or a row that no declaration covers fails by name, and a declared one the tree no longer
// prints fails by name too. Where the docs build renders a page, a failure names the module to
// edit, because `scripts/docs-build.test.ts` refuses a served page that is not what its module
// renders.
//
// What it cannot: the words are held, not the pixels. A label the app computes rather than
// declares, a control that moved while its label stayed, and a menu label a page prints on its own
// with no head to walk from (`website/docs/guides.mjs`'s "Save As", which the declaration does not
// name) are beyond a text guard.
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// @ts-ignore — js file, no type declarations
import { APP_PATHS } from '../website/docs/app-paths.mjs'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

/** The declaration the paths live in, named in the failures: covering a path is its job. */
const DECLARATION = 'website/docs/app-paths.mjs'
/** The directory the page modules live in: a built page is rendered from one of them. */
const MODULES = 'website/docs'
/** The file the toolbar's brand and its caret are drawn in. */
const TOOLBAR = 'src/renderer/src/components/layout/Toolbar.tsx'
/** The file the File menu is declared in, with the labels and accelerators its items carry. */
const FILE_MENU = 'src/shared/fileMenu.ts'
/** The file the window's other menus are declared in — the Edit menu and the Playback menu. */
const MAIN = 'src/main/index.ts'
/** The file the Settings dialog's tabs are declared in, `Backup machine` among them. */
const SETTINGS_DIALOG = 'src/renderer/src/components/layout/SettingsDialog.tsx'
/** The file the Show Settings dialog's tabs are declared in. */
const SHOW_SETTINGS = 'src/renderer/src/components/show/ShowSettings.tsx'

/** The five files the app's own words are read out of. */
const SOURCES = [TOOLBAR, FILE_MENU, MAIN, SETTINGS_DIALOG, SHOW_SETTINGS]

/** One app declaration a path's word answers to, in the module's own spelling. */
interface RawName {
  menu?: string
  item?: string
  tab?: string
  showTab?: string
  /** The word is the page's own: it names the item rather than quoting the app's label for it. */
  own?: boolean
}

/** One declared path, as `website/docs/app-paths.mjs` writes it. */
interface RawPath {
  page: string
  printed: string
  names: RawName[]
}

/** The kinds a declared word may be, which is what the app declares it under. */
const KINDS = ['menu', 'item', 'tab', 'showTab'] as const

/** One kind of app declaration. */
type Kind = (typeof KINDS)[number] | 'nothing'

/** A path word's app declaration, as the checks read it. */
interface Name {
  kind: Kind
  /** The id the app declares it under. */
  id: string
  /** Whether the word is the page's own rather than the app's label. */
  own: boolean
  /** How a failure names the declaration: `the settings tab \`redundancy\``. */
  what: string
}

/** One declared path, as the checks read it: the page and the words, and what each word names. */
interface Declared {
  /** The page under `website/`, as the declaration names it. */
  page: string
  /** The page as a failure names it, with the module that renders it when one does. */
  location: string
  /** The path as the page prints it. */
  printed: string
  /** Both of the above as a failure opens with them: `<page> prints "<words>"`. */
  said: string
  names: Name[]
}

/** An item of one of the app's menus: what it is called, the keys it is bound to, and where. */
interface MenuItem {
  /** Which menu declares it: a File menu `action`, or another menu's `id`. */
  kind: 'menu' | 'item'
  id: string
  label: string
  accelerator?: string
  file: string
}

/** A dialog tab as the app declares it: the id a declaration names, and the label it shows. */
interface Tab {
  id: string
  label: string
}

/** One cell of a table row, as a page prints it: its words, and whether it carries a key. */
interface Cell {
  text: string
  kbd: boolean
}

/** One row of a served table, read for the keys and the words beside them. */
interface Row {
  cells: Cell[]
}

/** One page as the deploy serves it: the file under `website/`, its markup, words and table rows. */
interface Page {
  page: string
  /** The page as a failure names it, with the module that renders it when one does. */
  location: string
  /** Its markup, as the guard reads a row's cells out of it. */
  html: string
  /** The page's words, read as a reader reads them. */
  text: string
  /** Its rows, each read for the keys and the words beside them. */
  rows: Row[]
}

/** What one check reads: the served tree, the app's sources, and the declaration. */
interface Reading {
  /** Every page the deploy serves, as the file it uploads. */
  pages: Page[]
  /** The app's own sources, by path, so a case can hand the checks a rename the tree never had. */
  files: Record<string, string>
  /** The declared paths. */
  paths: Declared[]
}

/** The app's own words, read out of the sources the declaration answers to. */
interface WordBook {
  brand: string
  caret: string
  /** Every item of every menu that carries an accelerator, which is what a keyboard row binds to. */
  items: MenuItem[]
  tabs: Tab[]
  showTabs: Tab[]
}

/** A path found in a page's words: where it sits, and the words it runs to. */
interface Found {
  index: number
  path: string
}

/** Reads a file a check cannot run without: an absent one is a failure, never a skip. */
function readFile(relative: string): string {
  try {
    return fs.readFileSync(path.join(root, relative), 'utf-8')
  } catch (cause) {
    throw new Error(
      `the served pages' app words: ${relative} cannot be read — ${(cause as Error).message}: a page held to a label that cannot be read is held to nothing`
    )
  }
}

/**
 * The file's text with its own line wrapping taken out — a label an array literal or a JSDoc wraps
 * across two lines reads as the one label it is, and a JSDoc's `*` prefixes go with the breaks —
 * so a label is read as the operator meets it in the app.
 */
const unwrapped = (source: string): string => source.replace(/\n\s*\*\s?/g, ' ')

/** A label read out of a source, or a failure naming the file: a comparison against nothing holds nothing. */
function labelIn(file: string, source: string, pattern: RegExp, what: string): string {
  const found = pattern.exec(unwrapped(source))
  if (found === null) {
    throw new Error(
      `${file} no longer carries ${what}: the guard reads it out of the declaration itself (${pattern}), so the file has to be read where the label moved`
    )
  }
  return found[1].replace(/\s+/g, ' ').trim()
}

/**
 * The body of a list a source declares — `const NAME: T[] = [ … ]` — and the number of objects it
 * holds. A reader that parses fewer items than the list holds would leave those items' labels out
 * of the vocabulary, which is a page held to nothing rather than a failure, so it can refuse.
 */
function listIn(file: string, source: string, declaration: string): { body: string; objects: number } {
  const text = unwrapped(source)
  const from = text.indexOf(`const ${declaration}`)
  // The list itself, from its opening bracket rather than from the type annotation's `[]`.
  const open = from === -1 ? -1 : text.indexOf('= [', from)
  const close = open === -1 ? -1 : text.indexOf('\n]', open)
  if (from === -1 || open === -1 || close === -1) {
    throw new Error(`${file} no longer declares \`${declaration}\` as a list: the app's own words are read out of those lists`)
  }
  const body = text.slice(open, close)
  return { body, objects: (body.match(/\{/g) ?? []).length }
}

/** The File menu's items, in the order the app declares them, read with the count the list holds. */
function menuIn(source: string): MenuItem[] {
  const { body, objects } = listIn(FILE_MENU, source, 'FILE_MENU')
  const items = [
    ...body.matchAll(/\{\s*action:\s*'([\w-]+)',\s*label:\s*'([^']+)'(?:,\s*accelerator:\s*'([^']+)')?\s*\}/g)
  ].map(found => ({ kind: 'menu' as const, id: found[1], label: found[2], accelerator: found[3], file: FILE_MENU }))
  if (items.length !== objects) {
    throw new Error(
      `${FILE_MENU}'s \`FILE_MENU\` holds ${objects} items and this guard reads ${items.length}: an item it cannot read is a label no page would be held to`
    )
  }
  if (items.length === 0) {
    throw new Error(
      `${FILE_MENU} carries no File menu item this guard can read: the menu is where a path's item labels and accelerators come from, so an unreadable one would hold every path to nothing`
    )
  }
  return items
}

/** The items of the app's other menus, read from the window's menu template by their `id`. */
function otherMenuIn(source: string): MenuItem[] {
  const items = [
    ...unwrapped(source).matchAll(/\{\s*id:\s*'([\w-]+)',\s*label:\s*'([^']+)',\s*accelerator:\s*'([^']+)'/g)
  ].map(found => ({ kind: 'item' as const, id: found[1], label: found[2], accelerator: found[3], file: MAIN }))
  const declared = (unwrapped(source).match(/accelerator:\s*'/g) ?? []).length
  if (items.length !== declared) {
    throw new Error(
      `${MAIN} declares ${declared} accelerators and this guard reads ${items.length} items: an item it cannot read is a key binding no keyboard row would be held to`
    )
  }
  if (items.length === 0) {
    throw new Error(
      `${MAIN} carries no menu item with an accelerator this guard can read: the Edit menu's Undo and Redo and the Playback menu's Panic are declared there, and a keyboard row is bound by exactly those keys`
    )
  }
  return items
}

/** One dialog's tabs, read from the list its own component declares, with the count it holds. */
function tabsIn(file: string, source: string, declaration: string): Tab[] {
  const { body, objects } = listIn(file, source, declaration)
  const tabs = [...body.matchAll(/\{\s*id:\s*'([\w-]+)',\s*label:\s*'([^']+)'/g)].map(found => ({
    id: found[1],
    label: found[2]
  }))
  if (tabs.length !== objects) {
    throw new Error(
      `${file}'s \`${declaration}\` holds ${objects} tabs and this guard reads ${tabs.length}: a tab it cannot read is a name a path would answer for nothing`
    )
  }
  if (tabs.length === 0) {
    throw new Error(
      `${file}'s \`${declaration}\` names no tab this guard can read, so a path answering to a tab would be held to nothing`
    )
  }
  return tabs
}

/** The app's own words: the brand and its caret, the menus' items, and the two dialogs' tabs. */
function words(reading: Reading): WordBook {
  const menu = menuIn(reading.files[FILE_MENU])
  return {
    // The brand is the toolbar button's own text, read from the caret span outward, so the two may
    // sit on one line or on two: a reflow is not a rename, and `[^\n<>{}]` keeps the match inside
    // the text the button carries rather than reaching back into its markup.
    brand: labelIn(
      TOOLBAR,
      reading.files[TOOLBAR],
      /(?:^|\n)\s*([^\n<>{}]*\S)\s*<span className="toolbar-brand-caret">/,
      'the brand its caret sits after'
    ),
    caret: labelIn(
      TOOLBAR,
      reading.files[TOOLBAR],
      /<span className="toolbar-brand-caret">\s*([^<]+?)\s*<\/span>/,
      'the brand caret'
    ),
    items: [...menu, ...otherMenuIn(reading.files[MAIN])],
    tabs: tabsIn(SETTINGS_DIALOG, reading.files[SETTINGS_DIALOG], 'SETTINGS_TABS'),
    showTabs: tabsIn(SHOW_SETTINGS, reading.files[SHOW_SETTINGS], 'SHOW_TABS')
  }
}

/** The character references a served page writes, decoded to the characters a reader meets. */
const NAMED_REFERENCES: Record<string, string> = {
  hellip: '…',
  rarr: '→',
  larr: '←',
  uarr: '↑',
  darr: '↓',
  mdash: '—',
  ndash: '–',
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  times: '×',
  middot: '·',
  copy: '©'
}

/** Every character reference in a page's text, read back to the character it stands for. */
function decode(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal: string) => String.fromCodePoint(Number(decimal)))
    .replace(/&([a-z]+);/gi, (whole, name: string) => NAMED_REFERENCES[name.toLowerCase()] ?? whole)
}

/**
 * A page's words as a reader reads them: its scripts, its styles and its comments left out — none
 * of them is a word on the page — its tags gone, an inline element's tags sitting between the
 * letters of a word (`<kbd>Ctrl</kbd>/<kbd>⌘</kbd>`), its character references decoded, and its
 * runs of space closed, since the markup's own line breaks are where a path wraps.
 */
const wordsOf = (html: string): string =>
  decode(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]*>/g, '')
  )
    .replace(/\s+/g, ' ')
    .trim()

/**
 * The module each page is rendered from, by the path that module declares it under: the served
 * `.html` is build output, and `scripts/docs-build.test.ts` holds it to the module that renders it,
 * so a failure names the file to edit rather than the file to rebuild. A hand-written page — the
 * redundancy walkthrough, the landing page — is rendered by nothing and appears in no entry.
 */
function pageModules(): Record<string, string> {
  let entries: string[]
  try {
    entries = fs.readdirSync(path.join(root, MODULES), { encoding: 'utf-8' })
  } catch (cause) {
    throw new Error(
      `the served pages' app words: ${MODULES}/ cannot be walked — ${(cause as Error).message}: a failure would name a page without naming the module that renders it`
    )
  }
  const renders: Record<string, string> = {}
  for (const entry of entries.filter(name => name.endsWith('.mjs')).sort()) {
    for (const declared of readFile(`${MODULES}/${entry}`).matchAll(/path:\s*'([^']+)'/g)) {
      renders[declared[1]] = `${MODULES}/${entry}`
    }
  }
  return renders
}

/** The module each served page is rendered from, read once. */
const RENDERS = pageModules()

/** A page as a failure names it: the file the deploy serves, and the module that renders it. */
function locationOf(page: string): string {
  const module = RENDERS[page]
  return module === undefined ? `website/${page}` : `website/${page} (rendered by ${module})`
}

/**
 * Every page under `website/` a deploy serves, as it stands: the hand-written ones and the ones the
 * docs build renders. `deploy-website.yml` uploads the tree itself, so the committed `.html` is
 * what a visitor reads, and it is what the walk reads the app's paths out of.
 */
function servedPages(): Page[] {
  let entries: string[]
  try {
    entries = fs.readdirSync(path.join(root, 'website'), { recursive: true, encoding: 'utf-8' })
  } catch (cause) {
    throw new Error(`the served pages' app words: website/ cannot be walked — ${(cause as Error).message}`)
  }
  const pages = entries.map(entry => entry.split(path.sep).join('/')).filter(entry => entry.endsWith('.html')).sort()
  if (pages.length === 0) {
    throw new Error("the served pages' app words: website/ holds no page to read, so a pass here would mean nothing")
  }
  return pages.map(page => pageReading(page, readFile(`website/${page}`)))
}

/** One page's reading: its markup, its words and its rows, from the file as the tree holds it. */
function pageReading(page: string, html: string): Page {
  return {
    page,
    location: locationOf(page),
    html,
    text: wordsOf(html),
    // A row may carry attributes (`<tr class="…">`), so the tag is read for its name alone.
    rows: [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].map(row => ({
      cells: [...row[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map(cell => ({
        text: wordsOf(cell[1]),
        kbd: /<kbd\b/.test(cell[1])
      }))
    }))
  }
}

/** One declared word, as the checks read it — refused loudly when an entry sets two kinds. */
function nameOf(entry: RawPath, name: RawName): Name {
  const set = KINDS.filter(kind => name[kind] !== undefined)
  if (set.length > 1) {
    throw new Error(
      `${DECLARATION} answers for ${set.map(kind => `\`${kind}: '${name[kind]}'\``).join(' and ')} in one word on the path "${entry.printed}" of website/${entry.page}: a word answers to one app declaration, and a guard given two would hold one of them against nothing`
    )
  }
  const [kind = 'nothing'] = set
  const id = kind === 'nothing' ? '' : String(name[kind])
  const what =
    kind === 'menu'
      ? `the File menu item \`${id}\``
      : kind === 'item'
        ? `the menu item \`${id}\``
        : kind === 'tab'
          ? `the settings tab \`${id}\``
          : kind === 'showTab'
            ? `the Show Settings tab \`${id}\``
            : 'nothing the app declares'
  return { kind, id, own: name.own === true, what }
}

/** The declaration as the checks read it: each word resolved, the page and its words composed once. */
function declared(paths: RawPath[]): Declared[] {
  return paths.map(entry => ({
    page: entry.page,
    location: locationOf(entry.page),
    printed: entry.printed,
    said: `${locationOf(entry.page)} prints "${entry.printed}"`,
    names: entry.names.map(name => nameOf(entry, name))
  }))
}

/** A dialog's own name as a path in prose writes it, which is the label without its ellipsis. */
const prose = (label: string): string => label.replace(/…$/, '')

/**
 * The words of a path, in the order the arrows walk them. One segment may name two controls, which
 * the page joins with its own word (`Settings → Network or MIDI` names both tabs), so a segment is
 * split on that word only when the declaration answers for more words than the arrows separate.
 * Read over the declaration's words alone, never over a page, so the splitter never guesses.
 */
function wordsOfPath(printed: string, expected: number): string[] {
  const walked = printed.split(/\s+→\s+/)
  if (walked.length - 1 < expected && /\s+or\s+/.test(walked[walked.length - 1])) {
    return [...walked.slice(0, -1), ...walked[walked.length - 1].split(/\s+or\s+/)]
  }
  return walked
}

/**
 * An accelerator as the keys a page prints, read as a set: `CmdOrCtrl` is the app's spelling of the
 * one key that differs between the keyboards, and the app and the site write the modifiers in
 * different orders (`Shift+CmdOrCtrl+Z` is the site's `Ctrl/⌘ + Shift + Z`), so the order is the
 * set's and not either writer's.
 */
function keysOf(accelerator: string): string {
  return accelerator
    .split('+')
    .map(part => part.trim())
    .map(part => (part === 'CmdOrCtrl' ? 'Ctrl/⌘' : part))
    .sort()
    .join(' + ')
}

/** The item a declared word answers to, from whichever menu declares it. */
function itemFor(book: WordBook, name: Name | undefined): MenuItem | undefined {
  if (name === undefined) return undefined
  if (name.kind === 'menu' || name.kind === 'item') return book.items.find(item => item.kind === name.kind && item.id === name.id)
  return undefined
}

/** The label the app declares for one word, and the file it declares it in. */
function wordFor(book: WordBook, name: Name): { label: string; file: string } | undefined {
  if (name.kind === 'menu' || name.kind === 'item') {
    const item = itemFor(book, name)
    return item === undefined ? undefined : { label: item.label, file: item.file }
  }
  const tabs = name.kind === 'tab' ? book.tabs : name.kind === 'showTab' ? book.showTabs : undefined
  const declaration = name.kind === 'tab' ? SETTINGS_DIALOG : SHOW_SETTINGS
  const tab = tabs?.find(entry => entry.id === name.id)
  return tab === undefined ? undefined : { label: tab.label, file: declaration }
}

/** What a declared path's head is: the caret, the keys of an item, a dialog's name, or nothing. */
type Head =
  | { kind: 'caret' }
  | { kind: 'keys'; item: MenuItem }
  | { kind: 'dialog'; item: MenuItem }
  | { kind: 'label' }
  | { kind: 'unknown' }

/**
 * The head a declared path hangs off, read from the words it prints: the brand with its caret (the
 * File menu itself), the keys one of the app's items is bound to (a row of the keyboard
 * reference), a dialog's own name (a path in prose), or nothing at all (a label printed on its
 * own, which carries its own words and no head). What the head has to be is checked by the caller,
 * so a head that has drifted is a failure naming what it should have been rather than a stranger.
 */
function headOf(book: WordBook, entry: Declared): Head {
  const walked = wordsOfPath(entry.printed, entry.names.length)
  const head = walked[0]
  const first = entry.names[0]
  if (head === `${book.brand} ${book.caret}` || head.endsWith(book.caret) || head.startsWith(book.brand)) {
    return { kind: 'caret' }
  }
  // The dialog a path in prose names: the File menu item that opens it, which the head has to be
  // the label of — with or without the ellipsis the site drops there.
  const action = first?.kind === 'tab' ? 'settings' : first?.kind === 'showTab' ? 'show-settings' : undefined
  const dialog = action === undefined ? undefined : book.items.find(item => item.kind === 'menu' && item.id === action)
  if (dialog !== undefined) return { kind: 'dialog', item: dialog }
  const item = itemFor(book, first)
  if (item?.accelerator !== undefined && walked.length > 1) return { kind: 'keys', item }
  return walked.length === 1 ? { kind: 'label' } : { kind: 'unknown' }
}

/** Whether a declared path is a row of the keyboard reference: the keys first, then the words. */
function isRow(book: WordBook, entry: Declared): boolean {
  return headOf(book, entry).kind === 'keys'
}

/** The words a page writes without the app's help: up to three words, stopping at punctuation. */
function upToThree(from: string): string {
  return from.match(/^([\w⌘/&'’…-]+(?:\s+[\w⌘/&'’…-]+){0,2})/)?.[1] ?? ''
}

/** Whether a name the app declares ends where the page's word does, rather than inside it. */
function wholeWord(text: string, name: string): boolean {
  return text.startsWith(name) && !/[\p{L}\p{N}]/u.test(text.slice(name.length, name.length + 1))
}

/**
 * The words a page's path runs to, read from the text after its head: the app's own name where the
 * page starts one (`Audio`, `Backup machine`, `Show History…`), because a path's words are the
 * app's names for its controls — and, where it starts something the app has no name for, up to
 * three words, so a page pointing at a control that has gone is read at all. One segment may name
 * two controls, joined by the page's own word (`Settings → Network or MIDI` names both tabs), and
 * the words after that join belong to the path: a longer path that starts where a declared one
 * starts is read as a path of its own rather than as the declared one plus a sentence.
 */
function pathWord(book: WordBook, text: string): string {
  const names = [...book.items.map(item => item.label), ...book.tabs.map(tab => tab.label), ...book.showTabs.map(tab => tab.label)]
    .sort((a, b) => b.length - a.length)
  const rest = text.replace(/^\s+/, '')
  const first = names.find(name => wholeWord(rest, name)) ?? upToThree(rest)
  const join = first === '' ? null : /^\s+or\s+/.exec(rest.slice(first.length))
  if (join === null) return first
  const after = rest.slice(first.length + join[0].length)
  const second = names.find(name => wholeWord(after, name)) ?? upToThree(after)
  return second === '' ? first : `${first} or ${second}`
}

/** The app-control paths a page's words walk: the brand with its caret, or a dialog's own name. */
function pathsIn(book: WordBook, text: string): Found[] {
  const dialogs = book.items
    .filter(item => item.kind === 'menu' && (item.id === 'settings' || item.id === 'show-settings'))
    .flatMap(item => [item.label, prose(item.label)])
  // Longest first: `Settings… →` is the dialog's name, and `Settings` alone is the same head
  // written the way a path in prose writes it.
  const heads = [`${book.brand} ${book.caret}`, ...dialogs]
    .sort((a, b) => b.length - a.length)
    .map(head => head.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const found: Found[] = []
  for (const match of text.matchAll(new RegExp(`(?:${heads.join('|')})\\s*→`, 'g'))) {
    const after = text.slice((match.index ?? 0) + match[0].length)
    const head = match[0].replace(/\s+/g, ' ').trim()
    const word = pathWord(book, after)
    found.push({ index: match.index ?? 0, path: word === '' ? head : `${head} ${word}` })
  }
  return found
}

/** Where a page prints the words a declaration holds it to, so a walk can tell covered from not. */
function rangesOf(text: string, printed: string[]): Array<{ from: number; to: number }> {
  const ranges: Array<{ from: number; to: number }> = []
  for (const words of printed) {
    let from = text.indexOf(words)
    while (from !== -1) {
      ranges.push({ from, to: from + words.length })
      from = text.indexOf(words, from + 1)
    }
  }
  return ranges
}

/**
 * The app's own word for the control a walked path ends on, when the page's word is nearly one of
 * the app's — the same letters with other punctuation, a label that has lost its ellipsis, or the
 * id behind it. A page that drifts by a letter or an ellipsis gets a failure saying what to write;
 * a word the app declares nothing for is left without one, because the app has nothing to say.
 */
function nearMiss(book: WordBook, walked: string): string {
  const last = wordsOfPath(walked, 1).pop()?.trim() ?? ''
  const near = [
    ...book.tabs.map(tab => ({ what: `the settings tab \`${tab.id}\``, label: tab.label, file: SETTINGS_DIALOG })),
    ...book.showTabs.map(tab => ({ what: `the Show Settings tab \`${tab.id}\``, label: tab.label, file: SHOW_SETTINGS })),
    ...book.items.map(item => ({
      what: `${FILE_MENU}'s item \`${item.id}\``,
      label: item.label,
      file: item.file
    }))
  ].find(
    candidate =>
      candidate.label.toLowerCase() === last.toLowerCase() ||
      prose(candidate.label).toLowerCase() === prose(last).toLowerCase() ||
      candidate.what.toLowerCase().endsWith(`\`${last.toLowerCase().replace(/\s+/g, '-')}\``)
  )
  return near === undefined || near.label === last
    ? ''
    : `, where the app calls that "${near.label}" (${near.file})`
}

/**
 * Every declared path's own words, held to the app's declarations: the head the path hangs off, the
 * keys a row prints, and the label each word names. A path under the brand caret and a keyboard row
 * carry the menu item's label exactly — unless the entry says the word is the page's own, which the
 * row answers for with its keys, and which `renderProblems` holds the page to; a prose path's head
 * is the dialog's own name, ellipsis or not.
 */
function wordProblems(reading: Reading): string[] {
  const book = words(reading)
  const problems: string[] = []
  for (const entry of reading.paths) {
    const walked = wordsOfPath(entry.printed, entry.names.length)
    const first = entry.names[0]
    if (first === undefined) {
      problems.push(`${DECLARATION} declares "${entry.printed}" on ${entry.location} and names no app control it answers to`)
      continue
    }
    const head = headOf(book, entry)
    if (head.kind === 'unknown') {
      problems.push(
        `${entry.said}, and its head "${walked[0]}" is neither ${TOOLBAR}'s brand and caret ("${book.brand} ${book.caret}"), keys an item of the app's menus is bound to, nor ${FILE_MENU}'s name for the dialog that path belongs to`
      )
      continue
    }
    if (head.kind === 'caret' && walked[0] !== `${book.brand} ${book.caret}`) {
      problems.push(`${entry.said} with the head "${walked[0]}", and ${TOOLBAR} draws the brand as "${book.brand} ${book.caret}"`)
    }
    if (head.kind === 'keys') {
      const keys = head.item.accelerator
      if (keys === undefined) {
        problems.push(`${entry.said} as a keyboard row, and ${head.item.file} gives ${first.what} no accelerator to hold its keys to`)
      } else if (keysOf(walked[0]) !== keysOf(keys)) {
        problems.push(
          `${entry.said} with the keys "${walked[0]}", and ${head.item.file} binds ${first.what} to "${keysOf(keys)}": a row belongs to the item whose accelerator it prints`
        )
      }
    }
    if (head.kind === 'dialog' && walked[0] !== head.item.label && walked[0] !== prose(head.item.label)) {
      problems.push(
        `${entry.said} and its head reads "${walked[0]}", where the app names that dialog "${head.item.label}" (${head.item.file}): a path in prose may drop the ellipsis and nothing else`
      )
    }
    const offset = head.kind === 'label' ? 0 : 1
    entry.names.forEach((name, index) => {
      const printedWord = walked[index + offset]
      if (printedWord === undefined) {
        problems.push(
          `${DECLARATION} answers for ${name.what} on the path "${entry.printed}" of ${entry.location}, which prints no such segment`
        )
        return
      }
      const declaredWord = wordFor(book, name)
      if (declaredWord === undefined) {
        problems.push(`${entry.said} with a word answering to ${name.what}, which the app does not declare`)
        return
      }
      // A word the page owns is held to the page, not to the app's label for the control: what
      // the row answers to is its keys, which are checked above, and the words it prints are
      // declared here and held by `renderProblems`.
      if (name.own) return
      if (printedWord !== declaredWord.label) {
        problems.push(`${entry.said} with the segment "${printedWord}", and ${declaredWord.file} calls ${name.what} "${declaredWord.label}"`)
      }
    })
  }
  return problems
}

/**
 * Every declared path, held to the page that prints it: a declared path must still render. A path
 * is read as prose — its own words, in the page's text — or, when it writes the keys an item is
 * bound to first, as a row of a table, where the two halves are those keys and the words beside
 * them.
 */
function renderProblems(reading: Reading): string[] {
  const book = words(reading)
  return reading.paths.flatMap(entry => {
    const page = reading.pages.find(candidate => candidate.page === entry.page)
    if (page === undefined) {
      return [`${DECLARATION} declares the path "${entry.printed}" on website/${entry.page}, which the tree does not serve`]
    }
    const walked = wordsOfPath(entry.printed, entry.names.length)
    if (!isRow(book, entry)) {
      return page.text.includes(entry.printed)
        ? []
        : [`${page.location} prints nothing matching "${entry.printed}", which ${DECLARATION} declares: the page lost the path or its words moved`]
    }
    // A keyboard row: the keys are the row's own cell, and the words the page gives them are the
    // cell beside it.
    const rows = page.rows.filter(row => row.cells.some(cell => cell.kbd && keysOf(cell.text) === keysOf(walked[0])))
    if (rows.length === 0) {
      return [`${page.location} carries no keyboard row for "${walked[0]}", which ${DECLARATION} declares as the path "${entry.printed}"`]
    }
    const want = walked.slice(1).join(' → ')
    if (rows.some(row => row.cells.some(cell => !cell.kbd && cell.text === want))) return []
    const reads = rows.flatMap(row => row.cells.filter(cell => !cell.kbd).map(cell => `"${cell.text}"`))
    const first = entry.names[0]
    const declaredWord = first === undefined ? undefined : wordFor(book, first)
    return [
      `${page.location}'s row for "${walked[0]}" reads ${reads.join(', ')}, and ${DECLARATION} declares the row "${want}"` +
        (declaredWord === undefined || first === undefined ? '' : ` — ${declaredWord.file} calls ${first.what} "${declaredWord.label}"`)
    ]
  })
}

/**
 * The other half of the guard: every app path the served tree prints, held to the declarations. A
 * path whose head is the brand's caret or a dialog's own name, and a table row whose keys cell
 * prints an accelerator one of the app's menus declares, are both read out of each page — a path
 * or a row nothing declares is a page pointing at a control, or a key binding, that has nothing
 * behind it, and it fails naming the page and the words.
 */
function undeclaredProblems(reading: Reading): string[] {
  const book = words(reading)
  const problems: string[] = []
  for (const page of reading.pages) {
    const declaredHere = reading.paths.filter(entry => entry.page === page.page)
    const covered = rangesOf(page.text, declaredHere.map(entry => entry.printed))
    for (const found of pathsIn(book, page.text)) {
      // A declared path covers exactly its own extent: a path that starts where a declared one
      // starts and runs on past its end is a longer path of its own, and fails alone.
      const inside = covered.some(range => found.index >= range.from && found.index + found.path.length <= range.to)
      if (!inside) {
        problems.push(`${page.location} prints "${found.path}", which ${DECLARATION} declares nothing for${nearMiss(book, found.path)}`)
      }
    }
    for (const row of page.rows) {
      const keys = row.cells.filter(cell => cell.kbd).map(cell => cell.text)
      // A row belongs to the item whose accelerator its keys cell prints; a row the app binds
      // nothing to is the page's own (a transport key, a selection key) and is not walked.
      const bound = book.items.find(
        item => item.accelerator !== undefined && keys.some(cell => keysOf(cell) === keysOf(item.accelerator as string))
      )
      if (bound === undefined) continue
      const holds = declaredHere.some(entry => isRow(book, entry) && keysOf(wordsOfPath(entry.printed, entry.names.length)[0]) === keysOf(bound.accelerator as string))
      if (!holds) {
        problems.push(
          `${page.location} prints the keys ${keys.map(cell => `"${cell}"`).join(' / ')} in a keyboard row, which ${bound.file} binds to ${bound.label}, and ${DECLARATION} declares no row for it`
        )
      }
    }
  }
  return problems
}

/** Every source the words are read out of, read once, each under the path a failure names. */
function sources(): Record<string, string> {
  const files: Record<string, string> = {}
  for (const file of SOURCES) files[file] = readFile(file)
  return files
}

/** The tree as the repository holds it, the app as it declares itself, the paths as declared. */
const LIVE: Reading = {
  pages: servedPages(),
  files: sources(),
  paths: declared(APP_PATHS as RawPath[])
}

/** The declared paths that hang under the brand caret, which a renamed toolbar brand all breaks. */
const UNDER_CARET = LIVE.paths.filter(entry => headOf(words(LIVE), entry).kind === 'caret')

/** The declared rows of the keyboard reference, which are held by the keys the app binds. */
const ROWS = LIVE.paths.filter(entry => isRow(words(LIVE), entry))

describe("the served pages' app words", () => {
  it('holds every declared path to the page that prints it', () => {
    expect(renderProblems(LIVE)).toEqual([])
  })

  it("holds every word to the app's own word for it", () => {
    expect(wordProblems(LIVE)).toEqual([])
  })

  it('walks the served tree for an app path and a keyboard row nothing declares', () => {
    expect(undeclaredProblems(LIVE)).toEqual([])
  })

  it('walks the paths the hand-written pages print, not only the generated ones', () => {
    // The walk holds every page under `website/`; a guard that walked only what the docs build
    // renders would hold the redundancy walkthrough's two paths to nothing.
    expect(UNDER_CARET.length + ROWS.length).toBeGreaterThan(0)
    expect(LIVE.paths.some(entry => entry.page === 'redundancy.html')).toBe(true)
  })
})

describe('an app label that moves', () => {
  it("names the app's new word and the page that prints the old one", () => {
    const renamed = {
      ...LIVE,
      files: {
        ...LIVE.files,
        [FILE_MENU]: LIVE.files[FILE_MENU].replace(
          "{ action: 'settings', label: 'Settings…'",
          "{ action: 'settings', label: 'Preferences…'"
        )
      }
    }
    // A rename that matched nothing would make this case pass without reading anything.
    expect(renamed.files[FILE_MENU]).not.toBe(LIVE.files[FILE_MENU])
    const problems = wordProblems(renamed)
    expect(problems).toContainEqual(
      expect.stringContaining(`${FILE_MENU} calls the File menu item \`settings\` "Preferences…"`)
    )
    expect(problems).toContainEqual(
      expect.stringContaining('website/reference/settings.html (rendered by website/docs/reference.mjs) prints "Cuerunner ▾ → Settings…" with the segment "Settings…"')
    )
    // The prose spelling is the dialog's name, so a renamed dialog takes every `Settings → …` with it.
    expect(problems).toContainEqual(
      expect.stringContaining('website/guides/running.html (rendered by website/docs/guides.mjs) prints "Settings → Audio" and its head reads "Settings"')
    )
    // And a keyboard row's label is the menu's word, so the reference's row goes with them.
    expect(problems).toContainEqual(
      expect.stringContaining('website/reference/keyboard.html (rendered by website/docs/reference.mjs) prints "Ctrl/⌘ + , → Settings…" with the segment "Settings…"')
    )
  })

  it('names the handover page, whose paths are written as character references', () => {
    const renamed = {
      ...LIVE,
      files: {
        ...LIVE.files,
        [FILE_MENU]: LIVE.files[FILE_MENU].replace(
          "{ action: 'history', label: 'Show History…'",
          "{ action: 'history', label: 'History…'"
        )
      }
    }
    expect(renamed.files[FILE_MENU]).not.toBe(LIVE.files[FILE_MENU])
    expect(wordProblems(renamed)).toContainEqual(
      expect.stringContaining(
        'website/guides/showfile.html (rendered by website/docs/guides.mjs) prints "Cuerunner ▾ → Show History…" with the segment "Show History…", and src/shared/fileMenu.ts calls the File menu item `history` "History…"'
      )
    )
  })

  it('names a label a page prints on its own, with no path around it', () => {
    const renamed = {
      ...LIVE,
      files: {
        ...LIVE.files,
        [FILE_MENU]: LIVE.files[FILE_MENU].replace(
          "{ action: 'import-bundle', label: 'Import Bundle…'",
          "{ action: 'import-bundle', label: 'Open Bundle…'"
        )
      }
    }
    expect(renamed.files[FILE_MENU]).not.toBe(LIVE.files[FILE_MENU])
    expect(wordProblems(renamed)).toEqual([
      expect.stringContaining(
        'website/guides/showfile.html (rendered by website/docs/guides.mjs) prints "Import Bundle…" with the segment "Import Bundle…", and src/shared/fileMenu.ts calls the File menu item `import-bundle` "Open Bundle…"'
      )
    ])
  })

  it('names the guide that prints a label on its own when the menu renames it', () => {
    const renamed = {
      ...LIVE,
      files: {
        ...LIVE.files,
        [FILE_MENU]: LIVE.files[FILE_MENU].replace(
          "{ action: 'save-as', label: 'Save As…'",
          "{ action: 'save-as', label: 'Save As Copy…'"
        )
      }
    }
    expect(renamed.files[FILE_MENU]).not.toBe(LIVE.files[FILE_MENU])
    expect(wordProblems(renamed)).toContainEqual(
      expect.stringContaining(
        'website/guides/first-show.html (rendered by website/docs/guides.mjs) prints "Save As…" with the segment "Save As…", and src/shared/fileMenu.ts calls the File menu item `save-as` "Save As Copy…"'
      )
    )
  })

  it('names the tab the dialog shows where a page prints another name', () => {
    const renamed = {
      ...LIVE,
      files: {
        ...LIVE.files,
        [SETTINGS_DIALOG]: LIVE.files[SETTINGS_DIALOG].replace(
          "{ id: 'redundancy', label: 'Backup machine'",
          "{ id: 'redundancy', label: 'Standby machine'"
        )
      }
    }
    expect(renamed.files[SETTINGS_DIALOG]).not.toBe(LIVE.files[SETTINGS_DIALOG])
    // Both pages that name that tab, each held to the app's own word for it.
    expect(wordProblems(renamed)).toEqual([
      expect.stringContaining(
        'website/guides/running.html (rendered by website/docs/guides.mjs) prints "Settings → Backup machine" with the segment "Backup machine", and ' +
          `${SETTINGS_DIALOG} calls the settings tab \`redundancy\` "Standby machine"`
      ),
      expect.stringContaining(
        'website/redundancy.html prints "Settings → Backup machine" with the segment "Backup machine", and ' +
          `${SETTINGS_DIALOG} calls the settings tab \`redundancy\` "Standby machine"`
      )
    ])
  })

  it('names the Show Settings tab a path walks into', () => {
    const renamed = {
      ...LIVE,
      files: {
        ...LIVE.files,
        [SHOW_SETTINGS]: LIVE.files[SHOW_SETTINGS].replace(
          "{ id: 'channels', label: 'Channels' }",
          "{ id: 'channels', label: 'Inputs' }"
        )
      }
    }
    expect(renamed.files[SHOW_SETTINGS]).not.toBe(LIVE.files[SHOW_SETTINGS])
    const problems = wordProblems(renamed)
    expect(problems).toContainEqual(
      expect.stringContaining(
        'website/reference/control.html (rendered by website/docs/reference.mjs) prints "Show Settings → Channels" with the segment "Channels"'
      )
    )
    // The formats page's own-file note names the same tab, so it is the fourth site.
    expect(problems).toContainEqual(
      expect.stringContaining(
        'website/reference/formats.html (rendered by website/docs/reference.mjs) prints "Show Settings → Channels" with the segment "Channels"'
      )
    )
    expect(problems).toContainEqual(
      expect.stringContaining(`${SHOW_SETTINGS} calls the Show Settings tab \`channels\` "Inputs"`)
    )
    expect(problems).toHaveLength(4)
  })

  it("holds the Edit menu's rows to the labels the window menu declares", () => {
    const renamed = {
      ...LIVE,
      files: {
        ...LIVE.files,
        [MAIN]: LIVE.files[MAIN].replace("label: 'Undo',", "label: 'Undo edit',")
      }
    }
    expect(renamed.files[MAIN]).not.toBe(LIVE.files[MAIN])
    expect(wordProblems(renamed)).toEqual([
      expect.stringContaining(
        'website/reference/keyboard.html (rendered by website/docs/reference.mjs) prints "Ctrl/⌘ + Z → Undo" with the segment "Undo", and src/main/index.ts calls the menu item `edit-undo` "Undo edit"'
      )
    ])
  })

  it("holds the row whose words are the page's own to the keys the app binds it to", () => {
    const rebound = {
      ...LIVE,
      files: {
        ...LIVE.files,
        [MAIN]: LIVE.files[MAIN].replace("accelerator: 'CmdOrCtrl+Shift+P'", "accelerator: 'CmdOrCtrl+Alt+P'")
      }
    }
    expect(rebound.files[MAIN]).not.toBe(LIVE.files[MAIN])
    expect(wordProblems(rebound)).toEqual([
      expect.stringContaining(
        'website/reference/keyboard.html (rendered by website/docs/reference.mjs) prints "Ctrl/⌘ + Shift + P → PANIC from the application menu — the same silence, reached without the window" with the keys "Ctrl/⌘ + Shift + P", and src/main/index.ts binds the menu item `playback-panic` to "Alt + Ctrl/⌘ + P": a row belongs to the item whose accelerator it prints'
      )
    ])
    // The same binding holds the File menu's rows whose words are the page's own.
    const newKeys = {
      ...LIVE,
      files: { ...LIVE.files, [FILE_MENU]: LIVE.files[FILE_MENU].replace("accelerator: 'CmdOrCtrl+N'", "accelerator: 'CmdOrCtrl+Alt+N'") }
    }
    expect(newKeys.files[FILE_MENU]).not.toBe(LIVE.files[FILE_MENU])
    expect(wordProblems(newKeys)).toContainEqual(
      expect.stringContaining('prints "Ctrl/⌘ + N → New workspace" with the keys "Ctrl/⌘ + N", and src/shared/fileMenu.ts binds the File menu item `new` to "Alt + Ctrl/⌘ + N"')
    )
  })

  it('holds a word the page owns to the page, and to the item the row answers to', () => {
    // The app renaming the item the row runs leaves the page's own words alone — that is what
    // `own` declares — while the row's keys still answer to the item.
    const renamed = {
      ...LIVE,
      files: {
        ...LIVE.files,
        [FILE_MENU]: LIVE.files[FILE_MENU].replace("{ action: 'new', label: 'New'", "{ action: 'new', label: 'Untitled'")
      }
    }
    expect(renamed.files[FILE_MENU]).not.toBe(LIVE.files[FILE_MENU])
    expect(wordProblems(renamed)).toEqual([
      expect.stringContaining(
        'website/guides/first-show.html (rendered by website/docs/guides.mjs) prints "Cuerunner ▾ → New" with the segment "New", and src/shared/fileMenu.ts calls the File menu item `new` "Untitled"'
      )
    ])
  })

  it('names the brand a caret path hangs off when the toolbar draws another one', () => {
    const renamed = {
      ...LIVE,
      files: {
        ...LIVE.files,
        [TOOLBAR]: LIVE.files[TOOLBAR].replace('            Cuerunner\n', '            CueRunner\n')
      }
    }
    expect(renamed.files[TOOLBAR]).not.toBe(LIVE.files[TOOLBAR])
    expect(wordProblems(renamed)).toEqual(
      UNDER_CARET.map(() => expect.stringContaining(`${TOOLBAR} draws the brand as "CueRunner ▾"`))
    )
  })

  it('reads the toolbar brand on one line or on two', () => {
    const reflowed = {
      ...LIVE,
      files: {
        ...LIVE.files,
        [TOOLBAR]: LIVE.files[TOOLBAR].replace(
          '            Cuerunner\n            <span className="toolbar-brand-caret">',
          '            Cuerunner <span className="toolbar-brand-caret">'
        )
      }
    }
    expect(reflowed.files[TOOLBAR]).not.toBe(LIVE.files[TOOLBAR])
    expect(wordProblems(reflowed)).toEqual([])
    expect(undeclaredProblems(reflowed)).toEqual([])
  })

  it('fails loudly when a file the labels are read from cannot be read', () => {
    expect(() => readFile('src/renderer/src/components/layout/NotAFile.tsx')).toThrow(
      "the served pages' app words: src/renderer/src/components/layout/NotAFile.tsx cannot be read"
    )
  })

  it('fails loudly when a dialog declares no tab this guard can read', () => {
    expect(() => tabsIn(SETTINGS_DIALOG, 'const SETTINGS_TABS: Tab[] = [\n]', 'SETTINGS_TABS')).toThrow(
      `${SETTINGS_DIALOG}'s \`SETTINGS_TABS\` names no tab this guard can read`
    )
  })

  it('fails loudly when a list holds an entry the reader cannot parse', () => {
    // The count is what makes it loud: a tab, a File menu item or an accelerator the reader
    // misses is a name no path would answer for, which is a pass rather than a failure.
    expect(() => tabsIn(SETTINGS_DIALOG, "const SETTINGS_TABS: Tab[] = [\n  { id: 'audio', name: 'Audio' }\n]", 'SETTINGS_TABS')).toThrow(
      `${SETTINGS_DIALOG}'s \`SETTINGS_TABS\` holds 1 tabs and this guard reads 0`
    )
    expect(() =>
      menuIn("export const FILE_MENU: FileMenuEntry[] = [\n  { action: 'new', title: 'New' }\n]")
    ).toThrow(`${FILE_MENU}'s \`FILE_MENU\` holds 1 items and this guard reads 0`)
    expect(() =>
      otherMenuIn(
        "        {\n          id: 'edit-undo',\n          label: 'Undo',\n          accelerator: 'CmdOrCtrl+Z'\n        },\n        {\n          label: 'Redo',\n          accelerator: 'Shift+CmdOrCtrl+Z'\n        }\n"
      )
    ).toThrow(`${MAIN} declares 2 accelerators and this guard reads 1 items`)
  })

  it('refuses a word that answers to two app declarations', () => {
    // The refusal is at the declaration's own reading, so a word that sets two kinds cannot be
    // held to one of them and quietly ignore the other.
    expect(() =>
      declared([{ page: 'reference/settings.html', printed: 'Cuerunner ▾ → Settings…', names: [{ menu: 'settings', tab: 'audio' }] }])
    ).toThrow(`${DECLARATION} answers for \`menu: 'settings'\` and \`tab: 'audio'\` in one word on the path "Cuerunner ▾ → Settings…" of website/reference/settings.html`)
  })
})

describe('a page that drifts from the declaration', () => {
  /** The live pages with one page's markup changed, and a failure when the change was not there. */
  function doctored(page: string, from: string, to: string): Reading {
    const before = LIVE.pages.find(candidate => candidate.page === page)
    if (before === undefined || !before.html.includes(from)) {
      throw new Error(`a case changed nothing on website/${page}: "${from}" is not there`)
    }
    const pages = LIVE.pages.map(candidate =>
      candidate.page === page ? pageReading(page, candidate.html.replace(from, to)) : candidate
    )
    return { ...LIVE, pages }
  }

  it('names the page and the segment when a path nothing declares appears', () => {
    const drifted = doctored(
      'guides/running.html',
      'Settings → Audio: the right output',
      'Settings → License: the right output'
    )
    expect(undeclaredProblems(drifted)).toEqual([
      expect.stringContaining(
        'website/guides/running.html (rendered by website/docs/guides.mjs) prints "Settings → License", which website/docs/app-paths.mjs declares nothing for'
      )
    ])
  })

  it('does not let a longer path ride on a declared one that starts where it starts', () => {
    const drifted = doctored('guides/sound.html', 'Settings → Audio.', 'Settings → Audio or License.')
    expect(undeclaredProblems(drifted)).toEqual([
      expect.stringContaining('website/guides/sound.html (rendered by website/docs/guides.mjs) prints "Settings → Audio or License"')
    ])
  })

  it('names the tab the dialog shows when a page walks to a tab by another name', () => {
    const drifted = doctored(
      'redundancy.html',
      '<em>Settings → Backup machine</em>, switch it on',
      '<em>Settings → Redundancy</em>, switch it on'
    )
    expect(undeclaredProblems(drifted)).toEqual([
      expect.stringContaining(
        'website/redundancy.html prints "Settings → Redundancy", which website/docs/app-paths.mjs declares nothing for, where the app calls that "Backup machine"'
      )
    ])
  })

  it('names the caret path a page adds behind the declaration', () => {
    const drifted = doctored(
      'guides/sound.html',
      'It can be the default for new cues in Settings → Audio.',
      'It opens from Cuerunner ▾ → Show History… or Settings → Audio.'
    )
    expect(undeclaredProblems(drifted)).toEqual([
      expect.stringContaining('website/guides/sound.html (rendered by website/docs/guides.mjs) prints "Cuerunner ▾ → Show History… or Settings"')
    ])
  })

  it('names the row a page adds for keys an item is bound to', () => {
    const drifted = doctored(
      'reference/keyboard.html',
      '<tr><td><kbd>Delete</kbd></td>',
      '<tr><td><kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>S</kbd></td><td>Save the show</td></tr><tr><td><kbd>Delete</kbd></td>'
    )
    // The row's keys are the File menu's, so it is bound to that item and the declaration has to
    // cover it: the page's words for them are not what binds it.
    expect(undeclaredProblems(drifted)).toEqual([])
  })

  it('reads a row by its keys, not by a cell that happens to equal a label', () => {
    const drifted = doctored(
      'reference/keyboard.html',
      '<td><kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>S</kbd></td><td>Save</td>',
      '<td>Ctrl/⌘ + S</td><td>Save</td>'
    )
    // The keys cell carries no key any more, so the row is not a keyboard row at all — and a
    // prose cell that equals a menu label is not a row for the walk to demand a declaration for.
    expect(undeclaredProblems(drifted)).toEqual([])
  })

  it('names the row nothing declares when a declaration goes missing', () => {
    const without = LIVE.paths.filter(entry => entry.page !== 'reference/keyboard.html' || !entry.printed.includes('Save As…'))
    expect(without.length).toBe(LIVE.paths.length - 1)
    expect(undeclaredProblems({ ...LIVE, paths: without })).toEqual([
      expect.stringContaining(
        'website/reference/keyboard.html (rendered by website/docs/reference.mjs) prints the keys "Ctrl/⌘ + Shift + S" in a keyboard row, which src/shared/fileMenu.ts binds to Save As…, and website/docs/app-paths.mjs declares no row for it'
      )
    ])
  })

  it("names the keyboard row that drops the label's ellipsis", () => {
    const drifted = doctored('reference/keyboard.html', '<td>Save As…</td>', '<td>Save As</td>')
    expect(renderProblems(drifted)).toEqual([
      expect.stringContaining(
        'website/reference/keyboard.html (rendered by website/docs/reference.mjs)\'s row for "Ctrl/⌘ + Shift + S" reads "Save As", and website/docs/app-paths.mjs declares the row "Save As…" — src/shared/fileMenu.ts calls the File menu item `save-as` "Save As…"'
      )
    ])
  })

  it("holds the words a row declares, even when they are the page's own", () => {
    const drifted = doctored('reference/keyboard.html', '<td>New workspace</td>', '<td>New show</td>')
    expect(renderProblems(drifted)).toEqual([
      expect.stringContaining(
        `website/reference/keyboard.html (rendered by website/docs/reference.mjs)'s row for "Ctrl/⌘ + N" reads "New show", and website/docs/app-paths.mjs declares the row "New workspace"`
      )
    ])
  })

  it('names the keyboard row the app binds to other keys', () => {
    const drifted = doctored('reference/keyboard.html', '<kbd>S</kbd></td><td>Save</td>', '<kbd>W</kbd></td><td>Save</td>')
    expect(renderProblems(drifted)).toEqual([
      expect.stringContaining('website/reference/keyboard.html (rendered by website/docs/reference.mjs) carries no keyboard row for "Ctrl/⌘ + S"')
    ])
  })

  it('holds the handover page, whose paths are written as character references', () => {
    const drifted = doctored('guides/showfile.html', 'Show History&hellip;', 'Show History')
    expect(renderProblems(drifted)).toEqual([
      expect.stringContaining(
        'website/guides/showfile.html (rendered by website/docs/guides.mjs) prints nothing matching "Cuerunner ▾ → Show History…"'
      )
    ])
  })

  it('names the word a declaration answers for and the path does not print', () => {
    const overreaching = LIVE.paths.map(entry =>
      entry.page === 'guides/sound.html'
        ? { ...entry, names: [...entry.names, { kind: 'tab' as const, id: 'updates', own: false, what: 'the settings tab `updates`' }] }
        : entry
    )
    expect(wordProblems({ ...LIVE, paths: overreaching })).toEqual([
      expect.stringContaining(
        'website/docs/app-paths.mjs answers for the settings tab `updates` on the path "Settings → Audio" of website/guides/sound.html (rendered by website/docs/guides.mjs), which prints no such segment'
      )
    ])
  })

})

describe('a declared path the page and the app do not back', () => {
  const SETTINGS = 'reference/settings.html'
  const atSettings = (entry: { page: string; printed: string }): boolean =>
    entry.page === SETTINGS && entry.printed === 'Cuerunner ▾ → Settings…'

  it('names the page that loses a declared path', () => {
    const pages = LIVE.pages.map(candidate =>
      candidate.page === SETTINGS
        ? pageReading(SETTINGS, candidate.html.replaceAll('Cuerunner ▾ → Settings…', 'Cuerunner ▾ → Preferences…'))
        : candidate
    )
    expect(renderProblems({ ...LIVE, pages })).toEqual(
      expect.arrayContaining([expect.stringContaining('prints nothing matching "Cuerunner ▾ → Settings…"')])
    )
  })

  it('names the page a declared path sits on and the tree does not serve', () => {
    const orphaned = LIVE.paths.map(entry => (atSettings(entry) ? { ...entry, page: 'settings-2026.html' } : entry))
    expect(renderProblems({ ...LIVE, paths: orphaned })).toEqual([
      expect.stringContaining('on website/settings-2026.html, which the tree does not serve')
    ])
  })

  it('names a path whose head answers to a File menu item the app does not declare', () => {
    const invented = LIVE.paths.map(entry =>
      atSettings(entry)
        ? { ...entry, names: [{ kind: 'menu' as const, id: 'preferences', own: false, what: 'the File menu item `preferences`' }] }
        : entry
    )
    expect(wordProblems({ ...LIVE, paths: invented })).toEqual([
      expect.stringContaining('with a word answering to the File menu item `preferences`')
    ])
  })

  it('names a path that names no app control at all', () => {
    const empty = LIVE.paths.map(entry => (atSettings(entry) ? { ...entry, names: [] } : entry))
    expect(wordProblems({ ...LIVE, paths: empty })).toHaveLength(1)
  })
})
