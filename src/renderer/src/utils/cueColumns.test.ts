// The cue list's columns as an operator arranges them: moved, sized, shown and hidden, and
// read back whole from a storage that was written by another build or not at all.
import { describe, it, expect, beforeEach } from 'vitest'
import {
  COLUMN_MAX_WIDTH, COLUMN_MIN_WIDTH, defaultLayout, layoutStyle, loadLayout, moveColumn, normaliseLayout,
  resizeColumn, saveLayout, shownColumns, toggleColumn, widthOf
} from './cueColumns'

describe('the column layout', () => {
  beforeEach(() => localStorage.clear())

  it('starts as the list has always looked: the four times, and the notes left to the inspector', () => {
    expect(shownColumns(defaultLayout())).toEqual(['dur', 'pre', 'post', 'adv'])
  })

  it('moves a column in front of another, or to the end', () => {
    const layout = defaultLayout()
    expect(moveColumn(layout, 'adv', 'dur').order).toEqual(['adv', 'dur', 'pre', 'post', 'notes'])
    expect(moveColumn(layout, 'dur', null).order).toEqual(['pre', 'post', 'adv', 'notes', 'dur'])
    expect(moveColumn(layout, 'pre', 'pre')).toBe(layout)
  })

  it('sizes a column within the range the handle allows', () => {
    const layout = defaultLayout()
    expect(widthOf(resizeColumn(layout, 'dur', 120), 'dur')).toBe(120)
    expect(widthOf(resizeColumn(layout, 'dur', 2), 'dur')).toBe(COLUMN_MIN_WIDTH)
    expect(widthOf(resizeColumn(layout, 'dur', 9999), 'dur')).toBe(COLUMN_MAX_WIDTH)
  })

  it('shows and hides a column', () => {
    const withNotes = toggleColumn(defaultLayout(), 'notes')
    expect(shownColumns(withNotes)).toContain('notes')
    expect(shownColumns(toggleColumn(withNotes, 'pre'))).toEqual(['dur', 'post', 'adv', 'notes'])
  })

  it('hands the header and rows one width and one place per column', () => {
    const style = layoutStyle(resizeColumn(moveColumn(defaultLayout(), 'notes', 'dur'), 'notes', 200)) as Record<string, string>
    expect(style['--col-notes-w']).toBe('200px')
    expect(style['--col-notes-order']).toBe('10')
    expect(style['--col-dur-order']).toBe('11')
  })

  it('survives the window being closed', () => {
    saveLayout(toggleColumn(moveColumn(defaultLayout(), 'adv', 'dur'), 'notes'))
    expect(loadLayout().order[0]).toBe('adv')
    expect(loadLayout().hidden).toEqual([])
  })

  it('reads a layout another build wrote, or nonsense, as a whole one', () => {
    expect(normaliseLayout({ order: ['post', 'gone', 'post'], hidden: ['notes', 'x'], widths: { dur: 1e6, nope: 3 } })).toEqual({
      order: ['post', 'dur', 'pre', 'adv', 'notes'],
      hidden: ['notes'],
      widths: { dur: COLUMN_MAX_WIDTH }
    })
    expect(normaliseLayout('nonsense')).toEqual(defaultLayout())
    localStorage.setItem('cuerunner.cueList.columns', '{not json')
    expect(loadLayout()).toEqual(defaultLayout())
  })
})
