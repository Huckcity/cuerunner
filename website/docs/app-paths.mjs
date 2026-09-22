// The app's own controls, as the served pages name them.
//
// The site sends readers to the app's dialogs, tabs and menu items, and it did so in words the
// app does not use: the reference printed "Cuerunner ▾ → Settings" and "→ Show Settings" without
// the ellipsis `src/shared/fileMenu.ts` puts on those labels, the keyboard reference printed
// "Save As" and "Settings" the same way, and `website/redundancy.html` sent readers to a
// "Redundancy" tab the dialog calls "Backup machine". Nothing read any of it, so a page could
// point at a control that had moved or been renamed and only the price page was held.
//
// So the paths are declared here, one entry per path the served tree prints, and
// `scripts/app-words.test.ts` holds them to the app and to the pages: each entry's words must
// still render, each word that names an app control must be the app's own word for it, and a path
// or a keyboard row the tree prints that no entry covers fails by name.
//
// What a path is: the words a reader follows, joined by the arrow the site writes — a path under
// the brand caret (`Cuerunner ▾ → Settings…`), a path that names a dialog in prose
// (`Settings → Audio`), a label a page prints on its own (`Import Bundle…`), or a row of the
// keyboard reference, whose two halves are the keys the app binds and what the page says they run
// (`Ctrl/⌘ + N → New workspace`).
//
// `names` is what each word after the path's head answers to, in the order the path walks them:
// `menu` is a File menu item (`src/shared/fileMenu.ts`, named by its action), `item` an item of
// another menu (`src/main/index.ts`, named by its id), `tab` a tab of the Settings dialog and
// `showTab` a tab of the Show Settings dialog (`SettingsDialog.tsx`, `ShowSettings.tsx`). Each is
// named by the id the app declares it under, and the word a failure compares is read out of the
// app's own source — never typed here, so a label that moves fails by name instead of being
// copied twice.
//
// Exactness is per path kind, as decided: a tab's name is the app's everywhere; a path under the
// brand caret carries the File menu item's label exactly, ellipsis included; a keyboard row belongs
// to the item whose accelerator it prints, and carries that item's label exactly — unless the entry
// says `own: true`, which is a word that is the page's own rather than the app's ("New workspace"
// for `New`, and the sentence the Panic row carries): the row then answers to the item by its keys,
// and the words it prints are held to the page by this file rather than to the app's label. A path
// that names a dialog in prose may print its name without the ellipsis (`Settings → Audio` stays as
// it is), so the guard holds those names rather than their punctuation. A word the app declares
// nothing for — the row a path walks on into, as `Settings → Network → OSC control` does — is part
// of `printed` and is not named.
import { BRAND, BRAND_CARET, LICENSE_TAB, SETTINGS_ITEM } from './pricing.mjs'
// The same words, as the pages that state them hold them: `trial.mjs` and `support.mjs` export
// the labels their own sentences are built from, and `scripts/pricing-page.test.ts` holds those to
// the app already. A path drawn from one of those pages reads the label out of that module, so the
// declaration is never the second place a word is written.
import { APP as TRIAL } from './trial.mjs'
import { LICENSE_TAB as SUPPORT_LICENSE_TAB, SETTINGS_ITEM as SUPPORT_SETTINGS_ITEM } from './support.mjs'

/** The head of a path under the window's brand, as the site writes it. */
const CARET = `${BRAND} ${BRAND_CARET}`

/** The Show Settings menu item, which no page module exports: the menu's own word for it. */
const SHOW_SETTINGS = 'Show Settings…'

/** A dialog's own name as a path in prose writes it, which is the label without its ellipsis. */
const prose = label => label.replace(/…$/, '')

/**
 * Every app-control path the served tree prints: the page as the deploy serves it, the path as
 * the page prints it, and the app declaration each word after the head answers to.
 */
export const APP_PATHS = [
  // Under the brand caret: the words after it are the File menu item, and they carry its label
  // exactly, ellipsis included.
  {
    page: 'pricing.html',
    printed: `${CARET} → ${SETTINGS_ITEM} → ${LICENSE_TAB}`,
    names: [{ menu: 'settings' }, { tab: 'license' }]
  },
  {
    page: 'trial.html',
    printed: `${TRIAL.menu} ${TRIAL.caret} → ${TRIAL.settings}`,
    names: [{ menu: 'settings' }]
  },
  {
    page: 'reference/settings.html',
    printed: `${CARET} → ${SETTINGS_ITEM}`,
    names: [{ menu: 'settings' }]
  },
  {
    page: 'reference/settings.html',
    printed: `${CARET} → ${SHOW_SETTINGS}`,
    names: [{ menu: 'show-settings' }]
  },
  {
    page: 'guides/first-show.html',
    printed: `${CARET} → Open Demo Workspace`,
    names: [{ menu: 'open-demo' }]
  },
  {
    page: 'guides/first-show.html',
    printed: `${CARET} → New`,
    names: [{ menu: 'new' }]
  },
  {
    page: 'guides/desk.html',
    printed: `${CARET} → ${SHOW_SETTINGS} → Channels`,
    names: [{ menu: 'show-settings' }, { showTab: 'channels' }]
  },

  // The handover page writes its four paths as character references (`&#9662;` for the caret,
  // `&rarr;` for the arrow, `&hellip;` for the ellipsis of the labels below): the guard reads a
  // page as a reader reads it, so these are the words it finds there.
  {
    page: 'guides/showfile.html',
    printed: `${CARET} → Show History…`,
    names: [{ menu: 'history' }]
  },
  {
    page: 'guides/showfile.html',
    printed: `${CARET} → Compare Show…`,
    names: [{ menu: 'compare' }]
  },
  {
    page: 'guides/showfile.html',
    printed: `${CARET} → Merge Show…`,
    names: [{ menu: 'merge' }]
  },
  {
    page: 'guides/showfile.html',
    printed: `${CARET} → Export Bundle…`,
    names: [{ menu: 'export-bundle' }]
  },
  // The fifth of that page's app words is a label on its own rather than a path: the handover
  // section names the item a reader picks, with no caret and no keys in front of it.
  {
    page: 'guides/showfile.html',
    printed: 'Import Bundle…',
    names: [{ menu: 'import-bundle' }]
  },
  // And the same shape on the first-show guide, where the demo is opened unsaved and the item
  // that keeps it is named on its own.
  {
    page: 'guides/first-show.html',
    printed: 'Save As…',
    names: [{ menu: 'save-as' }]
  },

  // In prose: the dialog's own name, which this spelling may print without its ellipsis, then the
  // tab's name, which is the app's word for it.
  {
    page: 'guides/console.html',
    printed: `${prose(SETTINGS_ITEM)} → Network → OSC control`,
    names: [{ tab: 'network' }]
  },
  {
    page: 'guides/console.html',
    printed: `${prose(SETTINGS_ITEM)} → MIDI → Listen to MIDI`,
    names: [{ tab: 'midi' }]
  },
  {
    page: 'guides/console.html',
    printed: `${prose(SETTINGS_ITEM)} → General → Repeat guard`,
    names: [{ tab: 'general' }]
  },
  {
    page: 'guides/desk.html',
    printed: `${prose(SHOW_SETTINGS)} → Channels`,
    names: [{ showTab: 'channels' }]
  },
  {
    page: 'guides/running.html',
    printed: `${prose(SETTINGS_ITEM)} → Audio`,
    names: [{ tab: 'audio' }]
  },
  {
    page: 'guides/running.html',
    printed: `${prose(SETTINGS_ITEM)} → Backup machine`,
    names: [{ tab: 'redundancy' }]
  },
  {
    page: 'guides/script.html',
    printed: `${prose(SETTINGS_ITEM)} → Network → Tablet view`,
    names: [{ tab: 'network' }]
  },
  {
    page: 'guides/sound.html',
    printed: `${prose(SETTINGS_ITEM)} → Audio`,
    names: [{ tab: 'audio' }]
  },
  {
    page: 'guides/wireless.html',
    printed: `${prose(SETTINGS_ITEM)} → Wireless → Add source`,
    names: [{ tab: 'wireless' }]
  },
  {
    page: 'guides/wireless.html',
    printed: `${prose(SHOW_SETTINGS)} → Mic plot`,
    names: [{ showTab: 'mic-plot' }]
  },
  {
    page: 'guides/wireless.html',
    printed: `${prose(SETTINGS_ITEM)} → Wireless`,
    names: [{ tab: 'wireless' }]
  },
  {
    page: 'redundancy.html',
    printed: `${prose(SETTINGS_ITEM)} → Backup machine`,
    names: [{ tab: 'redundancy' }]
  },
  {
    page: 'reference/control.html',
    printed: `${prose(SETTINGS_ITEM)} → General`,
    names: [{ tab: 'general' }]
  },
  {
    page: 'reference/control.html',
    printed: `${prose(SHOW_SETTINGS)} → Channels`,
    names: [{ showTab: 'channels' }]
  },
  {
    page: 'reference/troubleshooting.html',
    printed: `${prose(SETTINGS_ITEM)} → Audio`,
    names: [{ tab: 'audio' }]
  },
  {
    page: 'reference/troubleshooting.html',
    printed: `${prose(SETTINGS_ITEM)} → MIDI`,
    names: [{ tab: 'midi' }]
  },
  // One arrow, two tabs: the page sends the reader to either.
  {
    page: 'reference/troubleshooting.html',
    printed: `${prose(SETTINGS_ITEM)} → Network or MIDI`,
    names: [{ tab: 'network' }, { tab: 'midi' }]
  },
  {
    page: 'reference/troubleshooting.html',
    printed: `${prose(SETTINGS_ITEM)} → Wireless`,
    names: [{ tab: 'wireless' }]
  },
  {
    page: 'support.html',
    printed: `${SUPPORT_SETTINGS_ITEM} → ${SUPPORT_LICENSE_TAB}`,
    names: [{ tab: 'license' }]
  },

  // The keyboard reference's rows: the keys the app binds, and what the page says they run. A row
  // is read for the item whose accelerator its keys cell prints, so the File menu's own five rows
  // are here, and so are the rows of the app's other menus — the Edit menu's Undo and Redo, and
  // the Playback menu's Panic, whose words are the page's rather than the menu's.
  {
    page: 'reference/keyboard.html',
    printed: 'Ctrl/⌘ + Shift + P → PANIC from the application menu — the same silence, reached without the window',
    names: [{ item: 'playback-panic', own: true }]
  },
  {
    page: 'reference/keyboard.html',
    printed: 'Ctrl/⌘ + N → New workspace',
    names: [{ menu: 'new', own: true }]
  },
  {
    page: 'reference/keyboard.html',
    printed: 'Ctrl/⌘ + O → Open workspace',
    names: [{ menu: 'open', own: true }]
  },
  {
    page: 'reference/keyboard.html',
    printed: 'Ctrl/⌘ + S → Save',
    names: [{ menu: 'save' }]
  },
  {
    page: 'reference/keyboard.html',
    printed: 'Ctrl/⌘ + Shift + S → Save As…',
    names: [{ menu: 'save-as' }]
  },
  {
    page: 'reference/keyboard.html',
    printed: 'Ctrl/⌘ + , → Settings…',
    names: [{ menu: 'settings' }]
  },
  {
    page: 'reference/keyboard.html',
    printed: 'Ctrl/⌘ + Z → Undo',
    names: [{ item: 'edit-undo' }]
  },
  {
    page: 'reference/keyboard.html',
    printed: 'Ctrl/⌘ + Shift + Z → Redo',
    names: [{ item: 'edit-redo' }]
  }
]
