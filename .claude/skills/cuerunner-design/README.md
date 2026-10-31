# Cuerunner Design System

## About

**Cuerunner** is a cross-platform QLab alternative for Windows — a professional show-control desktop application built with Electron + React + TypeScript. It is the primary product by Huckcity.

QLab is the industry-standard macOS show-control tool used in live theatre, concerts, and events to trigger audio, MIDI, OSC, video, and lighting cues. Cuerunner brings this capability to Windows.

### Source

- **Codebase:** GitHub — `Huckcity/cuerunner` (public, `main` branch)
- **Figma:** None provided
- **Design system:** Derived entirely from the codebase CSS and component files

---

## Products / Surfaces

| Surface | Description |
|---|---|
| **Desktop App** | Electron + React renderer — the only current surface. A single-window, full-screen dark UI. |

The app is a single-window layout with four main zones:
1. **Toolbar** — file menu (Cuerunner ▾), workspace name, + Add Cue buttons
2. **Cue List** — virtualized table of cues, drag-to-reorder, file-drop support
3. **Inspector** — right panel, tabbed settings for the selected cue
4. **Waveform Panel** — canvas-rendered audio waveform below the cue list
5. **Context bar** — live on the left, next on the right, each with the cue's number, name and first note
6. **Transport Bar** — STOP and GO, the running count and standing alarms, and the keys

---

## CONTENT FUNDAMENTALS

### Tone & Voice
- **Terse, technical, professional.** This is a tool for audio engineers and show operators, not a consumer app.
- **No marketing fluff.** Labels are direct: "Audio", "MIDI", "OSC", "Fade", "Stop", "Panic".
- **Lowercase is preferred** for status text and secondary labels: "idle", "playing", "pre-wait", "post-wait" — but the transport's two presses are UPPERCASE: "STOP", "GO".
- **A hint fits on one line.** It says when a setting matters and stops. If it cannot, the explanation belongs in the reference docs on the site, not on the panel. No lectures about ports, CORS or which process does the work.
- **No emoji** anywhere in the UI.
- **Minimal copy.** Empty states say exactly what they need: "No cues. Add cues using the toolbar above, or drag audio files here." / "Select a cue to inspect it."
- **Technical abbreviations are fine:** Pre-W, Post-W, Adv, ms, dB, Hz.
- **Keyboard shortcut style:** macOS-style (⌘N, ⇧⌘S, ⌘O) — likely because the app targets Windows but the developer is macOS-native. Shortcuts shown inline in menus next to item label.

### Casing Rules
| Context | Case |
|---|---|
| Transport buttons | ALL CAPS |
| Section headers in inspector | UPPERCASE, small, letter-spaced |
| Column headers in cue list | UPPERCASE, small, letter-spaced |
| Menu items, tabs | Title Case |
| Labels & status text | lowercase |
| Cue types (in buttons) | Title Case: Audio, MIDI, OSC, Wait, Fade, Stop, Group, Network, Script |

### Language Patterns
- **Cue types** are nouns/verbs, not descriptions: "Audio", "MIDI", "Fade", "Stop"
- **Actions** are imperative: "Browse", "Add Message", "Add Argument", "Reset start time"
- **States** are past participles or nouns: "playing", "pre-wait", "idle", "running"
- **Placeholders** are lowercase, parenthetical: "play to end", "No file selected", "F0 41 10 42 12 ... F7"

---

## VISUAL FOUNDATIONS

### Color

The Cuerunner palette is a **deep dark theme** with a single amber accent and a blue interactive accent. Backgrounds are near-black neutrals with a slight blue-ink bias — one panel steps off another without a border doing the work — and only interactive elements and status indicators use colour.

**There are four text tones and every one of them is readable.** Each clears 4.5:1 against
every surface it can sit on; `scripts/theme.test.ts` reads `App.css` and fails the build if
that stops being true. A fifth, `--fg-disabled`, is deliberately below the bar and is for
disabled controls, which WCAG exempts. Do not introduce a sixth grey.

| Role | Value | Usage |
|---|---|---|
| **bg-base** | `#14171b` | App background, body |
| **bg-surface** | `#1a1d22` | Toolbar, inspector panel |
| **bg-raised** | `#171a1f` | Cue list header, transport bar |
| **bg-well** | `#0f1216` | Waveform panel |
| **bg-card** | `#20242a` | MIDI message blocks, group child rows |
| **bg-input** | `#272c33` | Form inputs, cue type buttons |
| **bg-hover** | `#30363e` | Button/input hover |
| **border** | `#2b3038` | Primary panel borders |
| **border-soft** | `#272c33` | Subtle dividers |
| **border-input** | `#3b424c` | Input borders |
| **fg-primary** | `#cdd3da` / `#eef1f4` | Main text |
| **fg-secondary** | `#a3adb8` / `#cdd3da` | Secondary text |
| **fg-muted** | `#a3adb8` | Labels, numbers |
| **fg-dim** | `#8e98a4` | Hints, column headers |
| **fg-ghost** | `#8e98a4` | Empty states, placeholders |
| **accent-amber** | `#f0b429` | Brand color — Cuerunner wordmark, dirty-dot, start-time marker, waveform start marker |
| **accent-blue** | `#5aa9ff` | Interactive — selected tab underline, focused input border, drop indicator, audio playhead, progress fill |
| **accent-blue-dim** | `#2e4f73` | Waveform fill (unplayed) |
| **state-green** | `#1c7a3c` | GO button background |
| **state-green-hover** | `#22924a` | GO button hover |
| **state-red** | `#8e2b28` | Panic, from the menu |
| **state-red-hover** | `#a83430` | Panic hover |
| **state-selected** | `#1b2a3b` | Selected cue row background (blue-tinted dark) |
| **state-playing** | `#16281d` | Playing cue row background (green-tinted dark) |
| **state-prewait** | `#2a2413` | Pre-wait cue row (amber-tinted dark) |

#### Cue Color Labels
Cues can be assigned a color label: none, red, orange, yellow, green, blue, purple, pink.
These show as a 6×20px colored bar on the left of each cue row.

| Label | Hex |
|---|---|
| none | transparent |
| red | `#e0443a` |
| orange | `#f08c2a` |
| yellow | `#f2c94c` |
| green | `#3bb66b` |
| blue | `#3d8fe0` |
| purple | `#9b59d0` |
| pink | `#e8489b` |

### Typography

The app **bundles IBM Plex** (latin subsets, via `@fontsource`, imported in
`src/renderer/src/main.tsx`). A show machine has no network to fetch a webfont from, and
the system UI font is a different face on every platform Cuerunner ships to — which is how
the same panel came out one size on Windows and another on macOS.

```
--font-ui:   'IBM Plex Sans', 'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, sans-serif;
--font-cond: 'IBM Plex Sans Condensed', 'IBM Plex Sans', 'Segoe UI', sans-serif;
--font-mono: 'IBM Plex Mono', 'Cascadia Mono', Consolas, 'SF Mono', monospace;
font-size: 13px (base)
-webkit-font-smoothing: antialiased
```

Condensed carries cue numbers, column headers, small caps labels, GO and dialog titles.
Mono carries times, ports and addresses, with tabular figures so a running clock does not
jitter. Everything else is the sans.

One scale, and each step has a job. Most of the window is `--text-base`: a field label,
its value and a cue row are all the same size, which is what makes a column of them line
up.

| Token | Size | Role |
|---|---|---|
| `--text-xs` | 11px | Small caps labels, column headers, badges |
| `--text-sm` | 12px | Hints, meta, times |
| `--text-base` | 13px | Labels, values, cue rows — the workhorse |
| `--text-md` | 14px | Panel headings |
| `--text-lg` | 16px | Dialog titles, the live cue, GO |
| `--text-xl` | 20px | The next cue's name |
| `--text-2xl` | 28px | The next cue's number |

| Role | Font | Size | Weight | Colour |
|---|---|---|---|---|
| Brand / wordmark | condensed | 16px | 700 | `#f0b429`, uppercase, ls 0.06em |
| Cue rows, field values | sans | 13px | 400 | `#cdd3da` |
| Field labels | sans | 13px | 400 | `#a3adb8` |
| Column / section headers | condensed | 11px | 600 | `#a3adb8`, uppercase, ls 0.08em |
| Times, ports, addresses | mono | 12px | 400 | `#cdd3da`, tabular nums |
| GO | condensed | 16px | 700 | white on `#1c7a3c` |

### Spacing & Layout

- **Grid:** 4px base unit. Gaps of 4, 8, 12, 16, 20, 24px (`--space-1`…`--space-6`).
- **Toolbar height:** 48px
- **Context bar (live / next):** 80px
- **Cue row height:** 34px
- **Cue list header:** 30px
- **Waveform panel:** 120px total (26px header + canvas)
- **Transport bar:** 64px
- **Inspector width:** 340px (fixed)
- **Inspector body padding:** 16px
- **Input height:** 30px; buttons 28 / 30 / 40px
- **Field grid:** one label column, `--field-label-w` 112px, `--field-gap` 10px. Every
  label-and-control pair in the window — inspector, settings, show settings, dialogs — is
  a `.field-row` on that grid. That is what makes a stack of fields a column rather than a
  ragged edge.
- **Scrollbar:** 8px wide, `#3b424c` thumb, `#171a1f` track

### Borders & Radius

- **Border color:** `#2b3038` (panel dividers), `#3b424c` (input/button borders), `#272c33` (subtle)
- **Border width:** 1px everywhere
- **Radius:** 3–6px. Inputs and buttons: 5px. Dialogs and trays: 6px. Pills: 11px. The cue colour stripe is 3px wide, full height, on the row's left edge.
- **No large or decorative radii.** Everything is tight and utilitarian.

### Backgrounds & Surfaces

- **No background images or illustrations.** Pure flat color.
- **No gradients** (except the waveform has a subtle one from played/unplayed coloring).
- **No textures.** The UI is entirely flat color blocks divided by 1px borders.
- **Panels are distinguished by subtle steps** in background darkness (111→1a1a1a→1e1e1e→252525→2a2a2a).

### Animation & Interaction

- **Transitions are fast and minimal:** 0.05–0.1s on background/color. No bounces, springs, or elaborate easing.
- **Playing cue row:** subtle `pulse` animation (background oscillates between `#16281d` ↔ `#1c3222`), 2s ease-in-out infinite.
- **Hover states:** background lightens by one step (e.g. `#272c33` → `#30363e`). No scale transforms, no opacity.
- **Active/press states:** background darkens (e.g. GO button `#1c7a3c` → `#165f2f`).
- **Focus ring:** replaced by a blue border (`#5aa9ff`) on inputs.
- **Drop indicator:** blue 2px line with a blue glow (`box-shadow: 0 0 6px rgba(74,158,255,0.6)`).
- **Drag opacity:** dragged rows fade to 35% opacity.

### Shadows & Elevation

- **Flat UI with one exception:** the file-menu dropdown has `box-shadow: 0 8px 24px rgba(0,0,0,0.5)`.
- **No inner shadows, no card shadows.** Elevation is communicated purely through background color steps.

### Cards

- Cards (MIDI message blocks, group child rows) have `background: #20242a`, `border-radius: 3–4px`, no border, no shadow.

### Imagery

- **No imagery.** No photos, illustrations, or icons beyond ASCII/Unicode glyphs used as type icons.

---

## ICONOGRAPHY

### Approach
Cuerunner uses **no icon library and no icon font**: the cue type icons are drawn by the app
itself, in `src/renderer/src/utils/cueIcons.tsx`. One 16×16 box, 1.5 stroke,
`currentColor`, `fill: none`, rendered through `<CueIcon type="…" />` which stamps
`data-type` on the SVG for stylesheets and tests to key off.

They were Unicode glyphs until 0.14, and that is a font's business rather than the app's:
`⏱` renders as a colour emoji on Windows, `{ }` is three characters wide where every other
icon is one, and none of them line up.

| Cue type | Drawing |
|---|---|
| audio | Five meter bars — the shape the app's own mark is built from |
| midi | A 5-pin DIN socket |
| osc | A message leaving a point |
| wait | A clock |
| fade | A level ramping down |
| stop | A rounded square |
| group | Rows under a header — **but in the cue list a group's slot holds its chevron**, which opens it |
| network | A globe |
| script | Braces |
| scene | Two faders |
| devamp | A loop, and the way out of it |
| msc | A command leaving this desk for another |

| Transport | Icon |
|---|---|
| GO | A filled play triangle, inline SVG |
| STOP | The word alone |

There is **no PANIC button**: it is ⇧Esc and the Playback menu, so it cannot be hit by a
sleeve mid-show. Other glyphs still used as text: `▾` (menu caret), `●` (dirty dot), `↻`
(reset), `✕` (remove / close).

---

## FILE INDEX

```
README.md                   — This file
SKILL.md                    — Agent skill definition
colors_and_type.css         — CSS custom properties for all colors + type tokens

assets/                     — No binary assets; all iconography is Unicode text

preview/                    — Design system card previews. Colours track the tokens; the
                              component cards are illustrative and may lag the app by a
                              release — src/renderer/src is the authority.
  colors-base.html          — Base background color ramp
  colors-fg.html            — Foreground / text colors
  colors-accent.html        — Accent colors (amber, blue, states)
  colors-cue-labels.html    — Cue color label swatches
  type-scale.html           — Typography scale specimen
  type-tokens.html          — Type token reference
  spacing-tokens.html       — Spacing & layout tokens
  component-toolbar.html    — Toolbar component
  component-cuelist.html    — Cue list + cue row
  component-inspector.html  — Inspector panel tabs
  component-transport.html  — Transport bar (STOP / GO)
  component-waveform.html   — Waveform panel
  component-buttons.html    — Button states (cue-type, transport, menu)
  component-inputs.html     — Form fields (input, select, checkbox, textarea)
  component-badges.html     — State pills, running badge

ui_kits/
  app/
    README.md               — App UI kit notes
    index.html              — Full interactive prototype
    Toolbar.jsx             — Toolbar component
    CueList.jsx             — Cue list + cue row components
    Inspector.jsx           — Inspector panel
    TransportBar.jsx        — Transport bar
    WaveformPanel.jsx       — Waveform panel
```
