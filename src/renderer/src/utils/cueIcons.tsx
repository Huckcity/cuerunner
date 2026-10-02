import type { CueType } from '../../../shared/cue'

/**
 * One icon per cue type, for every surface that names a type: the list, the toolbar, the
 * menus, the dock.
 *
 * These were Unicode glyphs, which is a font's business rather than the app's: `⏱` comes
 * out as a colour emoji on Windows, `{ }` is three characters wide where every other icon
 * is one, and none of them line up with each other. They are drawn here instead — one
 * 16×16 box, 1.5 stroke, `currentColor` — so a row of them is a column, and a type reads
 * the same on every machine the app ships to.
 *
 * Each is distinct: a scene is not a group, so it does not borrow a group's.
 */
const PATHS: Record<CueType, string[]> = {
  // A level meter, the shape the app's own mark is built from.
  audio: ['M2.5 6.5v3', 'M5.5 4v8', 'M8.5 2.5v11', 'M11.5 5v6', 'M14 7v2'],
  // A 5-pin DIN socket.
  midi: ['M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2', 'M8 4.6v.01', 'M5.2 6.6v.01', 'M10.8 6.6v.01', 'M6.1 9.8v.01', 'M9.9 9.8v.01'],
  // A message leaving a point, the way OSC is drawn on a patch sheet.
  osc: ['M4 11.4v.01', 'M4 7.6a4 4 0 0 1 4 4', 'M4 3.8a7.8 7.8 0 0 1 7.8 7.8'],
  // A clock, because a wait is a duration.
  wait: ['M8 3.2a5.4 5.4 0 1 0 0 10.8 5.4 5.4 0 0 0 0-10.8', 'M8 5.8v2.9l2 1.5', 'M6.4 1.6h3.2'],
  // A level ramping down.
  fade: ['M2.5 4h2.5l6 8h2.5', 'M2.5 12.2h11'],
  stop: ['M4 4.4h8v7.2H4z'],
  // Rows under a header: a cue with cues inside it.
  group: ['M3 3h10v2.6H3z', 'M5.5 8.4h7.5', 'M5.5 11.4h7.5', 'M3 8.4v3'],
  // The network, not one device on it.
  network: ['M8 2.2a5.8 5.8 0 1 0 0 11.6 5.8 5.8 0 0 0 0-11.6', 'M2.4 8h11.2', 'M8 2.2c1.9 2.2 1.9 9.4 0 11.6', 'M8 2.2C6.1 4.4 6.1 11.6 8 13.8'],
  script: ['M6.4 2.6c-1.6 0-2.2.5-2.2 2v1.5c0 1-.5 1.9-1.4 1.9.9 0 1.4 1 1.4 1.9v1.5c0 1.5.6 2 2.2 2', 'M9.6 2.6c1.6 0 2.2.5 2.2 2v1.5c0 1 .5 1.9 1.4 1.9-.9 0-1.4 1-1.4 1.9v1.5c0 1.5-.6 2-2.2 2'],
  // Two faders: a scene is a position the desk is put into.
  scene: ['M5.5 2.5v11', 'M10.5 2.5v11', 'M3.6 6.4h3.8', 'M8.6 9.6h3.8'],
  // A loop, and the way out of it.
  devamp: ['M3 8a4 4 0 0 1 4-4h2.8', 'M8.2 2.2 10.6 4 8.2 5.8', 'M13 8a4 4 0 0 1-4 4H6.2', 'M7.8 10.2 5.4 12l2.4 1.8'],
  // A command leaving this desk for another one.
  msc: ['M2.4 4.2h6.4v7.6H2.4z', 'M4.6 7.4v1.2', 'M6.6 7.4v1.2', 'M10.4 8h3.2', 'M12.2 6.4 13.8 8l-1.6 1.6'],
  // A microphone: the capsule, the cradle it sits in, and the stand.
  mic: ['M8 2a2 2 0 0 0-2 2v3.6a2 2 0 0 0 4 0V4a2 2 0 0 0-2-2z', 'M4.4 7.4a3.6 3.6 0 0 0 7.2 0', 'M8 11v2.6', 'M5.8 13.6h4.4']
}

interface Props {
  type: CueType
  /** Extra classes for the surface the icon sits in. */
  className?: string
}

/**
 * The icon for a cue type. `data-type` is what tests and stylesheets key off, so neither
 * has to know what the drawing is.
 */
export function CueIcon({ type, className }: Props) {
  return (
    <svg
      className={className === undefined ? 'cue-icon' : `cue-icon ${className}`}
      data-type={type}
      viewBox="0 0 16 16"
      width="16"
      height="16"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[type].map(d => <path key={d} d={d} />)}
    </svg>
  )
}

/**
 * The chevron a group is opened and shut by. In the cue list it stands in for the group's
 * own icon: the row has one place for a glyph, and on a group that place is the control
 * that opens it — which is also how the list gets its disclosure column back.
 */
export function GroupChevron({ open, className }: { open: boolean; className?: string }) {
  return (
    <svg
      className={className === undefined ? 'cue-icon group-chevron' : `cue-icon group-chevron ${className}`}
      data-type="group"
      data-open={open}
      viewBox="0 0 16 16"
      width="16"
      height="16"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M5 6.2 8 9.4l3-3.2" />
    </svg>
  )
}

/** The drawings themselves, for the test that holds them apart. */
export const CUE_ICON_PATHS = PATHS
