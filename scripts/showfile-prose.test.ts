// The words around the saved shape, held to what this build does with a file.
//
// Five sentences promised a migration this build does not perform: README.md's workspace-format
// section twice — its history passage and its `WorkspaceManager` paragraph — the reference's
// older-show note and the page it renders to, the showfile guide's history passage, and the
// integration harness's older-workspace bullet, which named a symbol the deletion removed.
// `ROADMAP.md` carried three more, each promising a field or a section filled in at load. Nothing
// read any of them, so a deletion's words could outlive the code indefinitely.
//
// What it reads: the five sites by path — `README.md`, `website/docs/reference.mjs`,
// `website/docs/guides.mjs`, `INTEGRATION-HARNESS.md` and `ROADMAP.md` — and, beside them, every
// `.html` and `.mjs` under `website/`, because `deploy-website.yml` uploads that tree as it
// stands: a promise typed into a module ships whether or not a rebuild has moved it into a page,
// and the hand-written pages are read for the same reason. A file that cannot be read and a tree
// that cannot be walked are failures rather than skips.
//
// Every sentence is read across this repository's hard wrapping — a sentence broken over two lines
// is the one sentence it is, reported at the line it starts on, and markdown's code is blanked
// before the rule sees it (a symbol between backticks is not a promise, while in a page or a module
// a backtick holds the prose itself) — and two rules are read from them:
//
// 1. No file this reads may promise that a show is converted. A promise is a migration verb or an
//    older-file clause, paired with the file, its shape or the moment it is read, and it is denied
//    only by a denial in its own clause: one sentence may promise a conversion in one half and
//    refuse an unrelated file in the other — "Older show files are migrated as they open, and a
//    file that fails to parse is refused." is a promise and fails — while the truth binds the two
//    together ("An older show file that leaves out a settings section this build writes is refused
//    by name"). Sentences that only share a word with the promise pass: "the inspector's fields
//    migrate onto it" is about UI fields, and `--legacy-peer-deps` is about npm.
// 2. The passage each promise lived in has to say what is true now. The passage is located by the
//    words that surround it, so a site may rewrite its surroundings without telling this guard,
//    and a passage whose markers are gone fails by name rather than passing quietly. Six passages
//    owe the refusal — a file this build does not know, refused rather than converted, by name:
//    `README.md`'s history bullet and workspace-format paragraph, the reference's workspace-file
//    section, the guide's history section, the harness's G1 bullet list, and `ROADMAP.md`'s R4
//    opening. Two `ROADMAP.md` passages owe the completion instead: the one section a load still
//    fills in is the firing guard a file carries none of, which is what those two lines promised
//    a filled-in section of.
//
// What it cannot see: a promise worded with neither of its two parts — no migration verb and no
// older-file clause, so "a file from an earlier release is filled in" is read as prose; a promise
// whose only file clause is a build rather than a file, when it carries no migration verb; a claim
// whose denial is joined to it by a plain comma alone, or sits in the next sentence, since a denial
// governs its own clause and a claim is read where its words are; a passage that keeps one half of
// the refusal and drops the other (the refusal still there, the file it names gone); and prose
// outside what it reads. The planning documents under `_bmad-output/` still describe the deleted
// migration; correcting those is `feat/sq-native-capture`'s, not this guard's.
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Reads a file the guard cannot run without: an absent input is a failure, never a skip. */
function read(relative: string): string {
  try {
    return fs.readFileSync(path.join(root, relative), 'utf-8')
  } catch (cause) {
    throw new Error(`showfile prose: ${relative} cannot be read — ${(cause as Error).message}`)
  }
}

/** One document the guard reads: the path a failure names, and the file as the tree holds it. */
interface Document {
  file: string
  text: string
}

/** One sentence of a document, with the line it starts on. */
interface Sentence {
  file: string
  line: number
  /** The sentence as it reads, its code spans and markup included, for a failure to quote. */
  text: string
  /** The same sentence as the promise rule reads it: markdown's code blanked, the rest as it stands. */
  prose: string
}

/**
 * A document's sentences: the text with its wrapping flattened — one space per newline, each
 * character's own line kept beside it — read as runs up to a full stop, so a sentence this
 * repository wraps over three lines is the one sentence it is and is reported where it starts.
 *
 * The runs are found in the text with its code blanked, for the files whose prose marks code with
 * backticks: markdown names a symbol that way (`migrateWorkspace` is the call, not an offer to
 * migrate) and a period inside a path (`src/main/workspace/migrate.test.ts`) is not the end of a
 * sentence. A page or a module marks its code up instead, and there a backtick delimits prose — a
 * module's template literal holds whole pages — so nothing is blanked, or the very sentences this
 * guard reads would go with it. Each sentence carries both: the words as they read, for a failure
 * to quote, and the same words as the promise rule reads them.
 */
function sentences(file: string, text: string): Sentence[] {
  let flat = ''
  const lineAt: number[] = []
  let line = 1
  for (let at = 0; at < text.length; at += 1) {
    flat += text[at] === '\n' ? ' ' : text[at]
    lineAt.push(line)
    if (text[at] === '\n') line += 1
  }
  const marks = file.endsWith('.md') ? /```[\s\S]*?```|`[^`]*`/g : null
  const words = marks === null ? flat : flat.replace(marks, span => ' '.repeat(span.length))
  const found: Sentence[] = []
  for (const match of words.matchAll(/[^.!?]+[.!?]*/g)) {
    const at = match.index ?? 0
    // A run begins where the sentence before it ended, which in a page or a module is the markup
    // closing that sentence: the tags that opened this one are not its words, so the sentence is
    // read from the first word after them, and reported on the line that word is on.
    const span = flat.slice(at, at + match[0].length).trimEnd()
    const lead = span.match(/^\s*(?:<\/?[a-zA-Z][^>]*>\s*)*/)?.[0].length ?? 0
    const said = span.slice(lead)
    if (said === '') continue
    found.push({
      file,
      line: lineAt[at + lead],
      text: said.replace(/\s+/g, ' '),
      prose: words.slice(at + lead, at + lead + said.length).replace(/\s+/g, ' ')
    })
  }
  return found
}

/** A migration said to happen. `auto-migrate` is covered too: the hyphen is a boundary. */
const MIGRATION = /\bmigrat\w*/i

/**
 * A file said to be older than this build — the clause a promise is written in when it names no
 * verb at all ("an older workspace is filled in by the same spread"). The punctuation between the
 * clause's words is part of it ("an older, hand-written workspace is brought up to shape", "an
 * older show file"), and the clause still runs to the noun: "the file you pick is the older side"
 * is not this, and neither is a build or a release said to be another one — the site's prose writes
 * about earlier releases that way, and a promise naming a build rather than a file is read through
 * its migration verb.
 */
const OLDER_FILE =
  /\bolder\b[\s,–—-]*(?:\w+[\s,–—-]+){0,2}(?:file|files|show|shows|workspace|workspaces|document|documents)\b/i

/** What a promise is about: the file, its shape, or the moment its bytes are read. */
const ABOUT_A_FILE =
  /\bshape\b|\b(?:file|files|show|shows|workspace|workspaces|document|documents)\b|\b(?:load\w*|open\w*|read\w*|save\w*|saving)\b/i

/**
 * What a promise says happens: the shape moved to this build's. `brought` is listed on purpose —
 * it is the past tense the promise is usually written in ("brought up to this build's shape"),
 * and a rule that knew only `bring` would let that one through. The migration verb is not in the
 * list: it is the promise's own trigger, and a verb that paired with itself would make every
 * sentence with "migrate" in it a promise.
 */
const CONVERSION =
  /\b(?:convert\w*|load\w*|fill\w*|bring\w*|brought\b|upgrad\w*|adopt\w*|rewrit\w*|reinterpret\w*|complet\w*)\b/i

/**
 * A sentence that denies the conversion: the refusal this build gives a file it does not know, or
 * the conversion said not to happen. It is read within one clause — see `promises` — because a
 * sentence says more than one thing.
 */
const DENIAL =
  /\b(?:refus\w*|reject\w*)\b|\b(?:not|never|no\s+longer)\s+(?:\w+\s+){0,2}(?:convert\w*|migrat\w*|load\w*|open\w*|read\b|bring\w*|brought\b|rewrit\w*|fill\w*|complet\w*)/i

/**
 * The breaks a sentence's claims are separated by: a semicolon, a colon, and the commas that join a
 * clause to the one before it. A plain comma is not one, so a denial after an aside still governs
 * the claim before it, and a dash does not break either — this repository writes its asides with
 * dashes, and "an older file — one that leaves out a section — is refused by name" is one claim.
 */
const CLAUSE_BREAKS = /;\s*|:\s*|,\s+(?:and|but|so|which|or|then)\s+/i

/**
 * Whether a sentence promises that a show file is converted rather than read as it stands.
 *
 * The claim is the migration verb or the older-file clause, paired with the file, its shape or the
 * moment it is read, and the denial is read in the clause that carries the claim rather than across
 * the sentence: a refusal beside a promise does not deny it ("Older show files are migrated as they
 * open, and a file that fails to parse is refused." is still a promise), while the truth binds the
 * two together ("An older show file that leaves out a settings section this build writes is refused
 * by name."). What that leaves: a sentence whose claim and denial are split by a plain comma alone
 * reads as denied, and a claim whose pair — the file, its shape, the moment it is read — sits in
 * another sentence is not read at all.
 */
function promises(prose: string): boolean {
  if (!ABOUT_A_FILE.test(prose) && !CONVERSION.test(prose)) return false
  return prose
    .split(CLAUSE_BREAKS)
    .some(clause => !DENIAL.test(clause) && (MIGRATION.test(clause) || OLDER_FILE.test(clause)))
}

/** A sentence that promises a conversion: where it is, and what it says. */
interface Promised {
  file: string
  line: number
  text: string
}

/** Every sentence in the documents that promises a conversion, in the order they are read. */
function promisedIn(documents: Document[]): Promised[] {
  return documents.flatMap(document =>
    sentences(document.file, document.text)
      .filter(each => promises(each.prose))
      .map(each => ({ file: each.file, line: each.line, text: each.text }))
  )
}

/** The failure for one promise, named as the file, the line and the sentence it was read from. */
function drift(found: Promised): string {
  return (
    `${found.file}:${found.line} says "${found.text}" — show files are not converted, so a promise` +
    ' like that one has to go: the shape is declared and checked and a file this build does not' +
    ' know is refused'
  )
}

/**
 * Whether a sentence states the refusal: the file, the fact and the name. All three are what the
 * operator acts on — a refusal that does not say which file, or does not say it will be named,
 * is not the sentence the funnel gives — so a passage that has lost any of them has stopped
 * saying what its site owes.
 */
function refusal(sentence: string): boolean {
  return (
    /\b(?:refus\w*|reject\w*)\b/i.test(sentence) &&
    /\b(?:by name|naming|name)\b/i.test(sentence) &&
    /\b(?:file|files|show|shows|workspace|workspaces|document|documents)\b/i.test(sentence)
  )
}

/**
 * Whether a sentence states what a load completes: the firing guard, given the default when a
 * file carries none. The section defaulting a load once did is gone, so the guard is the one
 * section left — which is what the two `ROADMAP.md` lines owe in place of the refusal.
 */
function completion(sentence: string): boolean {
  return (
    /\b(?:triggerGuard|guard|windowMs)\b/i.test(sentence) &&
    /\b(?:complet\w*|fill\w*|stand\w*|default\w*)\b/i.test(sentence) &&
    /\b(?:load\w*|open\w*|read\w*)\b/i.test(sentence)
  )
}

/** One passage a promise lived in, and what the passage owes now. */
interface Obligation {
  file: string
  /** What the passage is, so a failure names it rather than the whole file. */
  passage: string
  /** The words before the passage: where the guard starts reading it. */
  from: string
  /** The words after it, or nothing for a passage that is the last thing in its file. */
  to: string
  /** What the passage owes, said in the failure. */
  owes: string
  /** Whether a sentence of the passage says it. */
  says: (sentence: string) => boolean
}

/** The refusal one passage owes, and the completion another does. */
const OWES_REFUSAL = 'the refusal: a file this build does not know, refused by name'
const OWES_COMPLETION = 'the section a load completes when a file carries none — the firing guard'

/**
 * The passages that promised a conversion, and what each owes now. Each is located by the words
 * around it rather than by a line number, so a site may rewrite its surroundings without telling
 * this guard, and a passage whose markers have gone is a failure rather than a skip.
 */
const OBLIGATIONS: Obligation[] = [
  {
    file: 'README.md',
    passage: 'the history bullet',
    from: '`history` records what a save changed',
    to: 'An `.cuerunnerx` bundle is a zip',
    owes: OWES_REFUSAL,
    says: refusal
  },
  {
    file: 'README.md',
    passage: 'the workspace-format paragraph',
    from: '`WorkspaceManager` (main process) handles I/O',
    to: '## Testing',
    owes: OWES_REFUSAL,
    says: refusal
  },
  {
    file: 'website/docs/reference.mjs',
    passage: 'the workspace-file section',
    from: 'id="workspace"',
    to: 'id="bundle"',
    owes: OWES_REFUSAL,
    says: refusal
  },
  {
    file: 'website/docs/guides.mjs',
    passage: 'the history section',
    from: 'id="history"',
    to: 'id="compare"',
    owes: OWES_REFUSAL,
    says: refusal
  },
  {
    file: 'INTEGRATION-HARNESS.md',
    passage: 'the G1 bullet list',
    from: '**Decided, and built — both routes, the native one first.**',
    to: '- `MidiTcpEngine` owns one socket per desk',
    owes: OWES_REFUSAL,
    says: refusal
  },
  {
    file: 'ROADMAP.md',
    passage: 'the R4 opening',
    from: '**Today.** Colour already exists end to end',
    to: '**Shape.** `selectedIds`',
    owes: OWES_REFUSAL,
    says: refusal
  },
  {
    file: 'ROADMAP.md',
    passage: 'the R6 setting paragraph',
    from: 'It is a show-wide setting, so it',
    to: 'None of the five',
    owes: OWES_COMPLETION,
    says: completion
  },
  {
    file: 'ROADMAP.md',
    passage: 'the decisions paragraph',
    from: 'Nothing here is waiting on an answer.',
    to: '',
    owes: OWES_COMPLETION,
    says: completion
  }
]

/**
 * Every obligation a passage has stopped meeting, each named with its file, the line the passage
 * starts on and what the passage owes. A file the guard was not given, a marker that has gone and
 * a passage whose words have gone are each a failure rather than a skip: silence is what this
 * guard exists to catch.
 */
function unmet(obligations: Obligation[], documents: Document[]): string[] {
  const failures: string[] = []
  for (const obligation of obligations) {
    const document = documents.find(each => each.file === obligation.file)
    if (document === undefined) {
      failures.push(`${obligation.file} is not among the files read, so its ${obligation.passage} went unchecked`)
      continue
    }
    const start = document.text.indexOf(obligation.from)
    if (start === -1) {
      failures.push(
        `${document.file} no longer says "${obligation.from}", so its ${obligation.passage} cannot be` +
        ' located — a passage the guard cannot find is a failure, never a skip'
      )
      continue
    }
    const end = obligation.to === '' ? document.text.length : document.text.indexOf(obligation.to, start)
    if (end === -1) {
      failures.push(
        `${document.file} no longer says "${obligation.to}", so its ${obligation.passage} cannot be` +
        ' ended — a passage the guard cannot find is a failure, never a skip'
      )
      continue
    }
    const passage = document.text.slice(start, end)
    if (sentences(document.file, passage).some(each => obligation.says(each.text))) continue
    const line = document.text.slice(0, start).split('\n').length
    failures.push(
      `${document.file}:${line} ${obligation.passage} no longer says ${obligation.owes}`
    )
  }
  return failures
}

/** The five sites the promises were written in, read by path — `ROADMAP.md` among them. */
const SITES = [
  'README.md',
  'website/docs/reference.mjs',
  'website/docs/guides.mjs',
  'INTEGRATION-HARNESS.md',
  'ROADMAP.md'
]

/**
 * Every file under `website/` the deploy serves, as the tree holds it: the rendered pages and
 * the hand-written ones, and every module they are rendered from. `deploy-website.yml` uploads
 * the tree itself, so a sentence typed into a module ships fetchable whether or not a rebuild has
 * moved it into a page.
 */
function siteTree(): Document[] {
  let entries: string[]
  try {
    entries = fs.readdirSync(path.join(root, 'website'), { recursive: true, encoding: 'utf-8' })
  } catch (cause) {
    throw new Error(`showfile prose: website/ cannot be walked — ${(cause as Error).message}`)
  }
  const served = entries
    .map(entry => entry.split(path.sep).join('/'))
    .filter(entry => entry.endsWith('.html') || entry.endsWith('.mjs'))
    .sort()
  if (served.length === 0) throw new Error('showfile prose: website/ holds nothing to read')
  return served.map(entry => ({ file: `website/${entry}`, text: read(`website/${entry}`) }))
}

/** The files the guard reads: the five sites by path, and the served tree beside them. */
function reading(): Document[] {
  const byFile = new Map<string, Document>()
  for (const file of SITES) byFile.set(file, { file, text: read(file) })
  for (const each of siteTree()) if (!byFile.has(each.file)) byFile.set(each.file, each)
  return [...byFile.values()]
}

/** The tree as the repository holds it, read once. */
const FILES = reading()

/** One file as the guard read it, for a case that edits it: the tree's text never changes. */
function fileIn(file: string): Document {
  const found = FILES.find(each => each.file === file)
  if (found === undefined) throw new Error(`showfile prose: ${file} was not read, so no case can edit it`)
  return found
}

/** The tree with one file replaced, for a case that drives a site's own words. */
function withFile(file: string, text: string): Document[] {
  return FILES.map(each => (each.file === file ? { file, text } : each))
}

/**
 * The line a passage starts on in a document, read from the passage's own words rather than typed:
 * an edit above the passage moves the line the guard reports, and a case that spelled the number
 * out would fail on an edit that changes nothing it is about.
 */
function lineOfPassage(file: string, text: string, passage: string): number {
  const obligation = OBLIGATIONS.find(each => each.file === file && each.passage === passage)
  if (obligation === undefined) throw new Error(`showfile prose: no obligation named ${passage} of ${file}`)
  return text.slice(0, text.indexOf(obligation.from)).split('\n').length
}

describe('a promise that a show is converted', () => {
  it('is not made in any file this repository publishes', () => {
    expect(promisedIn(FILES).map(drift)).toEqual([])
  })

  it('is read across this repository’s hard wrapping, with the line each sentence starts on', () => {
    // The five prose sentences as the sites wrote them, wrapped as they wrapped them: the README's
    // history passage and its `WorkspaceManager` paragraph, the reference's older-show note, the
    // guide's history passage and the harness's older-workspace bullet — and, last, an older-file
    // clause written with the punctuation a clause takes.
    const asWritten = [
      '  values, which are in the file the save replaced. An unedited save appends nothing; bringing',
      "  an older file up to this version's shape is a change to the file rather than to the show and",
      '  is not recorded as an edit.',
      '',
      '`WorkspaceManager` (main process) handles I/O and auto-migrates legacy fields on load: old',
      '`childIds` arrays become `parentId` pointers, missing timing fields are filled with defaults,',
      'the pre-`advance` `autoContinue`/`autoFollow` flags are dropped, a stop cue without',
      '`waitForFade` gains `false`, and the retired per-output `deviceId` and `channelPair` fields are',
      'dropped.',
      '',
      '        Older show files are migrated as they open: the settings that were once',
      '        <code>autoContinue</code> and <code>autoFollow</code> become',
      '        <strong>Advance</strong>, and groups that listed their children become children',
      '        that name their parent. Saving writes the current shape.',
      '',
      "        saves compares as unchanged. Bringing an older file up to this version's shape is",
      "        a change to the file rather than to the show, so it is not recorded as an edit.",
      '',
      '  OSC kind, and `DeskMessage` gains the matching variant; an older workspace is filled in',
      '  by the same `normalizeShowSettings` spread that fills every other new field, and the E2E',
      '  spec opens a file written without the field to prove it.',
      '',
      '  An older, hand-written workspace is brought up to this build’s shape.'
    ].join('\n')

    const found = promisedIn([{ file: 'probe.md', text: asWritten }])

    expect(found.map(each => each.line)).toEqual([1, 5, 11, 16, 19, 23])
    expect(found.map(each => each.text)).toEqual([
      "An unedited save appends nothing; bringing an older file up to this version's shape is a" +
      ' change to the file rather than to the show and is not recorded as an edit.',
      '`WorkspaceManager` (main process) handles I/O and auto-migrates legacy fields on load: old' +
      ' `childIds` arrays become `parentId` pointers, missing timing fields are filled with defaults,' +
      ' the pre-`advance` `autoContinue`/`autoFollow` flags are dropped, a stop cue without' +
      ' `waitForFade` gains `false`, and the retired per-output `deviceId` and `channelPair` fields' +
      ' are dropped.',
      'Older show files are migrated as they open: the settings that were once <code>autoContinue</code>' +
      ' and <code>autoFollow</code> become <strong>Advance</strong>, and groups that listed their' +
      ' children become children that name their parent.',
      "Bringing an older file up to this version's shape is a change to the file rather than to the" +
      ' show, so it is not recorded as an edit.',
      'OSC kind, and `DeskMessage` gains the matching variant; an older workspace is filled in by the' +
      ' same `normalizeShowSettings` spread that fills every other new field, and the E2E spec opens a' +
      ' file written without the field to prove it.',
      'An older, hand-written workspace is brought up to this build’s shape.'
    ])
  })

  it('is read where the roadmap wrote it too, and named with its line and sentence', () => {
    // The three `ROADMAP.md` lines promised a field or a section filled in at load, worded without
    // an older-file clause: the migration verb is what carries them.
    const roadmap = [
      'persisted in the workspace, defaulted on migration (`WorkspaceManager.ts`) and by `cueDefaults.ts`.',
      '',
      'as an optional section the migration fills in — the pattern showSettings already set.',
      '',
      'beside audioSettings and showSettings in the workspace document, filled in by the migration.'
    ].join('\n')

    expect(promisedIn([{ file: 'ROADMAP.md', text: roadmap }]).map(drift)).toEqual([
      'ROADMAP.md:1 says "persisted in the workspace, defaulted on migration (`WorkspaceManager.ts`) and' +
      ' by `cueDefaults.ts`." — show files are not converted, so a promise like that one has to go: the' +
      ' shape is declared and checked and a file this build does not know is refused',
      'ROADMAP.md:3 says "as an optional section the migration fills in — the pattern showSettings' +
      ' already set." — show files are not converted, so a promise like that one has to go: the shape' +
      ' is declared and checked and a file this build does not know is refused',
      'ROADMAP.md:5 says "beside audioSettings and showSettings in the workspace document, filled in by' +
      ' the migration." — show files are not converted, so a promise like that one has to go: the shape' +
      ' is declared and checked and a file this build does not know is refused'
    ])
  })

  it('is read in a page the scan was never told about', () => {
    // The walk is the point: `website/docs/*.mjs` and every page are read without being listed, so
    // a page added tomorrow that repeats the promise fails this guard on the run that adds it.
    const probe: Document = {
      file: 'website/guides/probe-page.html',
      text: '<p>Older show files are migrated as they open.</p>'
    }

    expect(promisedIn([probe]).map(drift)).toEqual([
      'website/guides/probe-page.html:1 says "Older show files are migrated as they open." — show' +
      ' files are not converted, so a promise like that one has to go: the shape is declared and' +
      ' checked and a file this build does not know is refused'
    ])
  })

  it('is read inside a module, where a backtick holds the prose rather than marking code', () => {
    // A module's pages live in a template literal, so blanking what sits between backticks — the
    // right thing in markdown, where a backtick marks a symbol — would blank the very sentences
    // this guard reads. The rendered page beside the module is read too, and a promise in the
    // module fails even while that page still carries the corrected words.
    const probe: Document = {
      file: 'website/docs/probe.mjs',
      text: [
        'export const PROBE = {',
        "  path: 'guides/probe-page.html',",
        '  body: `',
        '    <p>A show is one file.</p>',
        '    <p>Older show files are migrated as they open.</p>',
        '`',
        '}'
      ].join('\n')
    }

    expect(promisedIn([probe]).map(drift)).toEqual([
      'website/docs/probe.mjs:5 says "Older show files are migrated as they open." — show files are' +
      ' not converted, so a promise like that one has to go: the shape is declared and checked and' +
      ' a file this build does not know is refused'
    ])
  })

  it('is read even when the same sentence refuses something else', () => {
    // A refusal beside a promise is not a denial of it: the denial is read in the clause that
    // carries the claim, so this sentence is named for the promise it still makes — while the
    // reference's own truthful sentence, which binds the refusal to the older file, passes.
    const both = [
      'Older show files are migrated as they open, and a file that fails to parse is refused.',
      '',
      'An older show file that leaves out a settings section this build writes is refused by name.'
    ].join('\n')

    expect(promisedIn([{ file: 'probe.md', text: both }]).map(drift)).toEqual([
      'probe.md:1 says "Older show files are migrated as they open, and a file that fails to parse is' +
      ' refused." — show files are not converted, so a promise like that one has to go: the shape is' +
      ' declared and checked and a file this build does not know is refused'
    ])
  })

  it('reads a sentence that denies the conversion as the denial, promise and all', () => {
    const truths = [
      'An older file is refused rather than migrated.',
      'A file this build does not know is not converted.',
      'Cuerunner does not open a file it cannot read.',
      'Show files are not brought up to this build’s shape.'
    ].join(' ')

    expect(promisedIn([{ file: 'probe.md', text: truths }])).toEqual([])
  })

  it('leaves the sentences that only share a word with the promise alone', () => {
    // Each read on its own: the npm flag, the inspector's fields, the comparison's older side and
    // the `.bak` a save keeps — every one of them carries a word the promise uses and none of them
    // promises that a show is converted.
    const nearMisses = [
      '# Install dependencies (add --legacy-peer-deps if npm reports ERESOLVE)',
      'The inspector’s fields migrate onto it, which also retires three private copies of the same' +
        ' draft-then-commit pattern.',
      'The file you pick is the older side, so read the heading as "what changed since this was written".',
      'Saves keep the previous version as <name>.cuerunner.bak.'
    ]

    for (const each of nearMisses) {
      expect(promisedIn([{ file: 'probe.md', text: each }]), each).toEqual([])
    }
  })
})

describe('the words each passage owes now', () => {
  it('is stated in every passage that used to promise a conversion', () => {
    expect(unmet(OBLIGATIONS, FILES)).toEqual([])
  })

  it('fails a passage that has stopped saying the refusal', () => {
    // The README's history bullet with its refusal sentence taken out: the promise is gone, and so
    // is the sentence that replaced it, which is the failure a silent site produces.
    const readme = fileIn('README.md')
    const silent = readme.text.replace(
      /The shape is declared and checked, and a file this build does not know is refused as\n  it opens, by name, with nothing on disk touched\./,
      'The file is read as it stands.'
    )
    expect(silent).not.toBe(readme.text)

    const failures = unmet(OBLIGATIONS, withFile('README.md', silent))

    expect(failures).toHaveLength(1)
    expect(failures[0]).toContain(`README.md:${lineOfPassage('README.md', silent, 'the history bullet')}`)
    expect(failures[0]).toContain('the history bullet')
    expect(failures[0]).toContain('no longer says the refusal')
  })

  it('fails a passage that has stopped saying what a load completes', () => {
    // The other half of the obligations: `ROADMAP.md`'s R6 paragraph owes the guard a load
    // completes, not the refusal, and a line that drops those words is a silent site too.
    const roadmap = fileIn('ROADMAP.md')
    const silent = roadmap.text.replace(
      'as an optional section a load completes with the default when a\nfile carries none — `triggerGuard` —',
      'as an optional section of the workspace document —'
    )
    expect(silent).not.toBe(roadmap.text)

    const failures = unmet(OBLIGATIONS, withFile('ROADMAP.md', silent))

    expect(failures).toHaveLength(1)
    expect(failures[0]).toContain(`ROADMAP.md:${lineOfPassage('ROADMAP.md', silent, 'the R6 setting paragraph')}`)
    expect(failures[0]).toContain('the R6 setting paragraph')
    expect(failures[0]).toContain('no longer says the section a load completes')
  })

  it('fails a passage whose markers are gone', () => {
    const roadmap = fileIn('ROADMAP.md')
    const moved = roadmap.text.replace('**Today.** Colour already exists end to end', '**Today.** Colour exists')
    expect(moved).not.toBe(roadmap.text)

    const failures = unmet(OBLIGATIONS, withFile('ROADMAP.md', moved))

    expect(failures).toHaveLength(1)
    expect(failures[0]).toContain('ROADMAP.md')
    expect(failures[0]).toContain('the R4 opening')
    expect(failures[0]).toContain('cannot be located')
  })

  it('fails a site that cannot be read rather than skipping it', () => {
    expect(() => read('website/docs/not-a-module.mjs')).toThrow(
      /showfile prose: website\/docs\/not-a-module\.mjs cannot be read/
    )
  })
})

describe('the files the scan reads', () => {
  it('is the served tree, listed or not', () => {
    const walked = siteTree().map(each => each.file)

    // A hand-written page, a page no module renders, a module at the tree's root and a rendered
    // page: none of them is in SITES, and all of them ship.
    expect(walked).toEqual(
      expect.arrayContaining([
        'website/index.html',
        'website/redundancy.html',
        'website/build-docs.mjs',
        'website/docs/reference.mjs',
        'website/reference/formats.html'
      ])
    )
  })

  it('is the five sites by path, `ROADMAP.md` among them', () => {
    expect(SITES).toContain('ROADMAP.md')
    expect(FILES.map(each => each.file)).toEqual(expect.arrayContaining(SITES))
  })
})
