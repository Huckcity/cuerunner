import type { CueType } from '../types/cue'

/**
 * One glyph per cue type, for every surface that names a type: the list, the toolbar,
 * the menus. Each is distinct — a scene is not a group, so it does not borrow a group's.
 */
export const CUE_ICON: Record<CueType, string> = {
  audio: '♪',
  midi: 'M',
  osc: 'O',
  wait: '⏱',
  fade: '↘',
  stop: '■',
  group: '▤',
  network: '⊕',
  script: '{ }',
  scene: '◇',
  devamp: '↩'
}
