// The settings reference, held to the app's own settings dialog and to the tab it documents.
//
// `website/reference/settings.html` is where a reader is sent to find out what a setting does —
// and nothing read it: the
// page's sections were its own words, so a tab the app renamed, a section answering to a tab that
// does not exist, and a tab the dialog shows with no section written for it would all ship. The
// two sides are declared now (website/docs/reference.mjs), and this guard holds them:
//
// - the dialog's tabs, read out of `SETTINGS_TABS` in `SettingsDialog.tsx` as text, because a
//   React component is not something this guard can import: every declared tab has exactly one
//   section, every section names a declared tab, and each section's heading is the tab's own
//   label, so the section a reader lands on is named the way the app names it;
// - the Channels tab's controls, read out of `ChannelsTab.tsx`: every row the page documents is a
//   control the tab prints, in the tab's order, and every control the tab prints is documented —
//   the guide sends a reader to that tab to set the desk's buttons, so the reference names the
//   fields they will find there.
//
// Every check is a pure function of what it reads, so the second describe can hand it a page the
// repository would never commit and get the failure back by name. The failure paths are what hold
// the page; a passing run on its own says only that nothing has drifted yet.
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// @ts-ignore — js file, no type declarations
import { CHANNELS_ROWS, REFERENCE, SETTINGS_SECTIONS } from '../website/docs/reference.mjs'
// @ts-ignore — js file, no type declarations
import { renderPage } from '../website/build-docs.mjs'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

/** The dialog the settings tabs and their blurbs are declared in. */
const SETTINGS_DIALOG = 'src/renderer/src/components/layout/SettingsDialog.tsx'
/** The tab the Channels rows are read out of. */
const CHANNELS_TAB = 'src/renderer/src/components/show/ChannelsTab.tsx'

/** One settings tab as the app declares it: the id, the label beside it and where its setting is kept. */
interface Tab {
  id: string
  label: string
  scope: string
}

/** One section of the settings page, and the tab it answers to. */
interface Section {
  tab: string
  anchor: string
}

/** One row the page declares: the label the app prints for it, and what the row is. */
interface Row {
  label: string
  prose: string
}

/** Everything the checks read, in one value: a case below hands them a mutation of it. */
interface Reading {
  tabs: Tab[]
  sections: Section[]
  channels: Row[]
  /** The sources the tabs and the rows are read from, read once. */
  files: Record<string, string>
  /** The settings page as the site serves it. */
  rendered: string
}

/**
 * The app's declared settings tabs, read as the file writes them — never a partial list, because
 * the sections are held to them: a reading that lost an entry would hold the page to a dialog
 * with fewer tabs than the app has. Each entry's three fields are read wherever they sit in it,
 * so a tab written as `{ label, id, scope }` is read as the tab it is.
 */
function settingsTabs(source: string): Tab[] {
  const declared = /const SETTINGS_TABS[^=]*=\s*\[([\s\S]*?)\n\]/.exec(source)?.[1]
  if (declared === undefined) {
    throw new Error(
      `${SETTINGS_DIALOG} no longer declares a \`SETTINGS_TABS\` array: the settings page's sections are held to the tabs the app declares, so a file this guard cannot read is not a dialog with no tabs`
    )
  }
  const entries = [...declared.matchAll(/\{[^{}]*\}/g)].map(found => found[0])
  const tabs = entries.map(entry => ({
    id: /\bid:\s*'([^']+)'/.exec(entry)?.[1] ?? '',
    label: /\blabel:\s*'([^']+)'/.exec(entry)?.[1] ?? '',
    scope: /\bscope:\s*'([^']+)'/.exec(entry)?.[1] ?? ''
  }))
  const unreadable = tabs.filter(tab => tab.id === '' || tab.label === '' || tab.scope === '')
  if (tabs.length === 0 || unreadable.length > 0) {
    throw new Error(
      `${SETTINGS_DIALOG}'s \`SETTINGS_TABS\` array carries ${entries.length} tab entr${entries.length === 1 ? 'y' : 'ies'} and this guard reads an id, a label and a scope out of ${tabs.length - unreadable.length} of them: the settings page documents every tab, so an array that does not parse entry by entry is a failure rather than a dialog with fewer tabs`
    )
  }
  return tabs
}

/** A section's heading as the rendered page carries it, with the Pro chip's word taken off it. */
function headingOf(rendered: string, anchor: string): string | undefined {
  const section = new RegExp(`<section[^>]*\\bid="${anchor}"[^>]*>\\s*<h2>([\\s\\S]*?)</h2>`).exec(rendered)
  return section?.[1]
    .replace(/<span class="pro">[\s\S]*?<\/span>/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** The text of one source file, or a failure: a tab read out of a file that cannot be read holds nothing. */
function readSource(relative: string): string {
  try {
    return fs.readFileSync(path.join(root, relative), 'utf-8')
  } catch (cause) {
    throw new Error(
      `the settings reference is held to ${relative}, which cannot be read — ${(cause as Error).message}`
    )
  }
}

/** Every source the tabs and the rows are read from, read once, each file under the name the failures use. */
function sources(): Record<string, string> {
  return {
    [SETTINGS_DIALOG]: readSource(SETTINGS_DIALOG),
    [CHANNELS_TAB]: readSource(CHANNELS_TAB)
  }
}

/** The page this guard reads, found by its own path rather than by where it sits in the list. */
const SETTINGS_PAGE = REFERENCE.find((page: { path: string }) => page.path === 'reference/settings.html')
if (SETTINGS_PAGE === undefined) {
  throw new Error('website/docs/reference.mjs no longer declares reference/settings.html: this guard reads the settings page by its path')
}

/** The page as the repository holds it, the app's own declarations as the code holds them. */
const LIVE: Reading = {
  tabs: settingsTabs(readSource(SETTINGS_DIALOG)),
  sections: SETTINGS_SECTIONS,
  channels: CHANNELS_ROWS,
  files: sources(),
  rendered: renderPage(SETTINGS_PAGE)
}

/**
 * The sections and the tabs, held both ways: every tab the app declares has exactly one section
 * documenting it — a section missing is the tab a reader is sent to that the page never covers —
 * and every section's tab is one the app declares, so a section written for a tab that was
 * renamed or dropped fails naming the tab rather than standing as documentation of nothing.
 */
function tabProblems(reading: Reading): string[] {
  const problems = [
    ...reading.tabs.flatMap(tab => {
      const sections = reading.sections.filter(section => section.tab === tab.id)
      if (sections.length === 1) return []
      return [
        sections.length === 0
          ? `${SETTINGS_DIALOG} declares the settings tab \`${tab.id}\` ("${tab.label}") and website/docs/reference.mjs documents no section for it: the settings page claims every setting in Cuerunner`
          : `${SETTINGS_DIALOG} declares the settings tab \`${tab.id}\` ("${tab.label}") and website/docs/reference.mjs names ${sections.length} sections for it (${sections.map(section => `#${section.anchor}`).join(', ')}): exactly one section documents a tab`
      ]
    }),
    ...reading.sections
      .filter(section => !reading.tabs.some(tab => tab.id === section.tab))
      .map(
        section =>
          `website/docs/reference.mjs's #${section.anchor} section answers to the settings tab \`${section.tab}\`, which ${SETTINGS_DIALOG}'s \`SETTINGS_TABS\` does not declare`
      )
  ]
  if (problems.length > 0) return problems
  // The page follows the dialog: a reader looking a tab up finds its section where the sidebar
  // puts it, so a page that documents the same tabs in another order fails here.
  const documented = reading.sections.map(section => section.tab)
  const dialog = reading.tabs.map(tab => tab.id)
  return documented.join() === dialog.join()
    ? []
    : [
        `website/docs/reference.mjs documents the tabs as ${documented.join(', ')} and ${SETTINGS_DIALOG}'s \`SETTINGS_TABS\` declares them as ${dialog.join(', ')}: the page's sections follow the order the dialog shows its tabs in`
      ]
}

/** Every section's heading, held to the label the app puts beside the tab it documents. */
function headingProblems(reading: Reading): string[] {
  return reading.sections.flatMap(section => {
    const tab = reading.tabs.find(candidate => candidate.id === section.tab)
    if (tab === undefined) return []
    const heading = headingOf(reading.rendered, section.anchor)
    if (heading === undefined) {
      return [
        `website/reference/settings.html renders no \`<section id="${section.anchor}">\` with a heading: website/docs/reference.mjs's section answers to the settings tab \`${section.tab}\`, so the page has to carry it`
      ]
    }
    return heading === tab.label
      ? []
      : [
          `the settings page's #${section.anchor} section is headed "${heading}" and the tab it answers to is labelled "${tab.label}": the section and the tab the app shows are named the same`
        ]
  })
}

/**
 * The Channels tab's controls, read as the file writes them: the tab's `<label>` texts (the markup
 * the other readers take) and the three controls it titles inside a `<span>` — its two count
 * dials and the rule's own sentence. In the order the file prints them; a label the file writes in
 * more than one branch (a host for the OSC connection and one for a TCP desk) is one control,
 * taken where it first appears.
 */
const CHANNELS_CONTROL =
  /<label\b(?![^>]*\/>)[^>]*>\s*([^<]+?)\s*<\/label>|<span className="(?:channel-count-label|dca-count-label)">([^<]+?)<\/span>|<span>([^<]+?)<\/span>/g

/** The controls the tab prints, in the order it prints them, each named once. */
function channelsControlsIn(source: string): string[] {
  const words = [...source.matchAll(CHANNELS_CONTROL)].map(found =>
    (found[1] ?? found[2] ?? found[3]).replace(/\s+/g, ' ').trim()
  )
  return [...new Set(words)]
}

/**
 * The Channels tab's controls, held to the tab the guide sends readers to: every row the page
 * documents is a control the tab prints, every control the tab prints is documented, and the two
 * are in the same order — the reference names the fields the operator will find, in the tab's own
 * words.
 */
function channelsRowProblems(reading: Reading): string[] {
  const shown = channelsControlsIn(reading.files[CHANNELS_TAB] ?? '')
  const declared = reading.channels.map(row => row.label)
  const missing = declared.filter(label => !shown.includes(label))
  const extra = shown.filter(label => !declared.includes(label))
  return [
    ...missing.map(
      label =>
        `website/docs/reference.mjs documents the Channels tab's "${label}" row and ${CHANNELS_TAB} prints no control with that label: the page and the tab name the same controls`
    ),
    ...extra.map(
      label =>
        `${CHANNELS_TAB} prints the Channels tab's "${label}" control and website/docs/reference.mjs documents no row for it: every control the tab shows belongs on the page`
    ),
    ...(missing.length > 0 || extra.length > 0 || shown.join(' / ') === declared.join(' / ')
      ? []
      : [
          `website/docs/reference.mjs documents the Channels tab's controls as "${declared.join(', ')}" and ${CHANNELS_TAB} prints them as "${shown.join(', ')}": the page follows the tab's order`
        ])
  ]
}

describe('the settings reference', () => {
  it('documents every settings tab the app declares, and only those', () => {
    expect(tabProblems(LIVE)).toEqual([])
  })

  it('heads each section with the label the app puts beside the tab', () => {
    expect(headingProblems(LIVE)).toEqual([])
  })

  it('documents the Channels tab\'s controls as the tab prints them', () => {
    expect(channelsRowProblems(LIVE)).toEqual([])
  })

  it('fails loudly on a dialog whose tabs it cannot read', () => {
    expect(() => settingsTabs('const somethingElse = []')).toThrow('no longer declares a `SETTINGS_TABS` array')
    expect(() => settingsTabs('const SETTINGS_TABS: string[] = [\n]')).toThrow(
      'and this guard reads an id, a label and a scope out of 0 of them'
    )
    expect(() => settingsTabs("const SETTINGS_TABS = [\n  { id: 'general', label: 'General' }\n]")).toThrow(
      'carries 1 tab entry and this guard reads an id, a label and a scope out of 0 of them'
    )
  })

  it('reads a tab whose fields are written in another order', () => {
    const reordered = LIVE.files[SETTINGS_DIALOG].replace(
      "{ id: 'updates', label: 'Updates', scope: 'machine' }",
      "{ label: 'Updates', scope: 'machine', id: 'updates' }"
    )
    expect(reordered).not.toBe(LIVE.files[SETTINGS_DIALOG])
    expect(settingsTabs(reordered)).toEqual(settingsTabs(LIVE.files[SETTINGS_DIALOG]))
  })
})

/**
 * The page the repository would never commit, one failure at a time: each case changes one thing
 * in the live reading and asserts the check names it. These are the states the checks exist to
 * refuse — the tab with no section, the section answering to no tab, the row that moved, the
 * heading that lost the app's word — and nothing else in the suite exercises them.
 */
describe('the page the checks exist to refuse', () => {
  it('names a tab the app declares and the page does not document', () => {
    const without = LIVE.sections.filter(section => section.tab !== 'updates')
    expect(tabProblems({ ...LIVE, sections: without })).toEqual([
      expect.stringContaining('declares the settings tab `updates` ("Updates") and website/docs/reference.mjs documents no section for it')
    ])
  })

  it('names a tab two sections answer to', () => {
    const twice = [...LIVE.sections, { tab: 'network', anchor: 'updates' }]
    expect(tabProblems({ ...LIVE, sections: twice })).toEqual([
      expect.stringContaining('declares the settings tab `network` ("Network") and website/docs/reference.mjs names 2 sections for it (#network, #updates)')
    ])
  })

  it('names a section answering to a tab the app does not declare', () => {
    const rogue = LIVE.sections.map(section => (section.anchor === 'backup' ? { ...section, tab: 'redundancy-settings' } : section))
    expect(tabProblems({ ...LIVE, sections: rogue })).toEqual([
      expect.stringContaining('declares the settings tab `redundancy` ("Backup machine") and website/docs/reference.mjs documents no section for it'),
      expect.stringContaining("website/docs/reference.mjs's #backup section answers to the settings tab `redundancy-settings`")
    ])
  })

  it('names a section whose heading loses the tab\'s label', () => {
    const renamed = LIVE.rendered.replace('<h2>Backup machine</h2>', '<h2>Redundancy</h2>')
    expect(headingProblems({ ...LIVE, rendered: renamed })).toEqual([
      expect.stringContaining('the settings page\'s #backup section is headed "Redundancy" and the tab it answers to is labelled "Backup machine"')
    ])
  })

  it('names a section the rendered page does not carry at all', () => {
    const absent = LIVE.rendered.replace(/<section class="panel reveal delay-3" id="backup">[\s\S]*?<\/section>/, '')
    expect(headingProblems({ ...LIVE, rendered: absent })).toEqual([
      expect.stringContaining('website/reference/settings.html renders no `<section id="backup">` with a heading')
    ])
  })

  it('names the two orders when the page documents the tabs in another one', () => {
    const swapped = LIVE.sections.map(section =>
      section.tab === 'general' ? { ...section, tab: 'audio' } : section.tab === 'audio' ? { ...section, tab: 'general' } : section
    )
    expect(tabProblems({ ...LIVE, sections: swapped })).toEqual([
      expect.stringContaining(
        'website/docs/reference.mjs documents the tabs as audio, general, midi, network, wireless, redundancy, timecode, updates and src/renderer/src/components/layout/SettingsDialog.tsx\'s `SETTINGS_TABS` declares them as general, audio, midi, network, wireless, redundancy, timecode, updates'
      )
    ])
  })

  it('fails loudly on a source file it cannot read', () => {
    expect(() => readSource('src/renderer/src/components/layout/NotAFile.tsx')).toThrow(
      'the settings reference is held to src/renderer/src/components/layout/NotAFile.tsx, which cannot be read'
    )
  })
})
