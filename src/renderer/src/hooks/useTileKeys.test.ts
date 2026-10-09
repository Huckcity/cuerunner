import { describe, expect, it } from 'vitest'
import { cueForTileKey, tileKeyOf, tileKeyRefusal } from './useTileKeys'
import { defaultCueLists, type CueListInfo } from '../../../shared/cueLists'

describe('a cart tile’s own key', () => {
  it('refuses the keys the window already answers, and takes any other', () => {
    for (const key of [' ', 'Escape', 'p', 'P', '1', '0', 'F5', 'F6', 'Enter', 'ArrowDown']) {
      expect(tileKeyRefusal(key), key).not.toBeNull()
    }
    expect(tileKeyRefusal(' ')).toBe('Space already does something in the window')
    for (const key of ['q', 'W', 'F9', ';']) expect(tileKeyRefusal(key), key).toBeNull()
    expect(tileKeyOf('W')).toBe('w')
  })

  it('finds the tile a key fires, in tab order, whichever list is in front', () => {
    const lists: CueListInfo[] = [
      ...defaultCueLists(),
      { id: 'fx', name: 'Effects', cart: true, tileKeys: [{ cueId: 'door', key: 'q' }] },
      { id: 'fx2', name: 'More', cart: true, tileKeys: [{ cueId: 'phone', key: 'q' }, { cueId: 'bell', key: 'f9' }] }
    ]
    expect(cueForTileKey(lists, 'Q')).toBe('door')
    expect(cueForTileKey(lists, 'F9')).toBe('bell')
    expect(cueForTileKey(lists, 'z')).toBeNull()
  })
})
