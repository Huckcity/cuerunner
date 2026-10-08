// The free/Pro line: what the free app is, and what a key turns on.
//
// The rows are declared here and rendered by the one commercial page
// (`website/docs/pricing.mjs`, served as `pricing.html`), so there is one place to keep them
// true. The app's own gates are the authority — ShowService.pro in the main process, and the
// ProLock surfaces in the window — and this declaration follows them; when the line moves, it
// moves here in the same change.
//
// The two tables are declared rows rather than markup: a row carries the words a buyer reads
// and the record's own identifiers behind them, and scripts/pro-page.test.ts reads that
// declaration against `capability-catalog.md` — every identifier a free column names classed
// free there, every one a Pro column names classed Pro, and every Pro class the record holds
// named by some row. A class this declaration leaves out, or sells the wrong way round, fails
// the build rather than the buyer.

/**
 * The phrase a claim carries where no run has proved it: a claim is only as strong as the lane
 * that ran (AD-24). This page makes four that no run does — hosting a real driver on WASAPI, Core
 * Audio, ALSA and JACK, the Allen &amp; Heath desks, show control end to end, and live discovery —
 * and each one says so in its own wording, inline, rather than in a section or a badge: two of the
 * four stand on the hardware lane and are unproved for want of a run, and the other two are
 * carried by no lane at all. ASIO is deliberately not one of them: the Windows lane hosts the
 * machine's own driver, so the phrase sits behind the backends no lane runs rather than behind the
 * engine row's whole sentence, and the clause that names ASIO is declared as a claim of its own.
 *
 * The string is shared rather than this page's own: `website/docs/interop.mjs` imports it for
 * the A&H and MSC claims its Lighting bullet makes, and both pages' claims are declared beside
 * them (`website/docs/pro.mjs`'s rows here, `website/docs/lane-claims.mjs` for `interop.html`),
 * which is what keeps a claim marked in more than one place marked with the same words. A row
 * that states such a claim declares it in `notYetProved` — the words the phrase has to sit
 * behind — and the guards hold each declaration to the phrase.
 */
export const NOT_YET_PROVED = '(not yet proved on real hardware)'

/**
 * The cue types the free app runs, in the order the page names them. The page's sentence is
 * built from this list, so a type that moves across the line moves the words with it, and the
 * guard reads the list against `CUE_TYPES` minus `PRO_CUE_TYPES`.
 */
const FREE_CUES = ['audio', 'MIDI', 'MIDI file', 'OSC', 'MSC', 'network', 'script', 'wait', 'fade', 'stop', 'group', 'devamp', 'memo', 'video', 'image', 'text']

/** How a count reads at the head of a sentence: "Eleven cue types". Past the last word, the numeral stands. */
const COUNT = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty']

/**
 * The cue stack's sentence: how many types the free app has, said as a reader says a list, and
 * the group behaviour beside them. The count and the list both come off `cues` — written out
 * by hand, either would be the copy that stays behind when the list moves — and it stays a
 * sentence with one type and with none. Exported so the guard can hold the count word it opens
 * with and read it against the cue types the code declares.
 */
export function cueSentence(cues) {
  const count = COUNT[cues.length] ?? String(cues.length)
  const types = cues.length === 1 ? 'cue type' : 'cue types'
  const listed = cues.length > 1 ? `${cues.slice(0, -1).join(', ')} and ${cues[cues.length - 1]}` : cues[0] ?? ''
  const named = listed === '' ? '' : ` — ${listed}`
  return `${count[0].toUpperCase()}${count.slice(1)} ${types}${named} — with playlist, random, sequence and timeline groups, pre- and post-waits, auto-advance, arm and disarm, colour, and undo.`
}

/**
 * The free half of the page: one row per capability, each naming the words a buyer reads in
 * the Details column and what they stand on — the record's boundary-table identifiers
 * (services by id, channels by literal) and the cue types the row names. The table is the
 * free half, so every identifier and cue type here is held to a free class.
 */
export const FREE_ROWS = [
  {
    label: 'The cue stack',
    free: {
      cues: FREE_CUES,
      prose: cueSentence(FREE_CUES)
    }
  },
  {
    label: 'The engine',
    free: {
      notYetProved: 'WASAPI shared and exclusive, Core Audio, ALSA and JACK',
      prose: `ASIO, through the interface's own driver — proved in CI against a real driver. WASAPI shared and exclusive, Core Audio, ALSA and JACK ${NOT_YET_PROVED}. Sample-accurate scheduling, level and pan per cue, a routing matrix, fades, loops and streaming.`
    }
  },
  {
    label: 'The waveform',
    free: {
      prose: `Zoom, onset detection, split, vamps and devamps, and trim silence at the edges — measured from the file itself.`
    }
  },
  {
    label: 'Cueing it',
    free: {
      identifiers: ['osc-in', 'midi-in', 'osc:send', 'midi:send'],
      cues: ['MSC'],
      notYetProved: 'show-control messages',
      prose: `OSC, MIDI and show-control messages ${NOT_YET_PROVED} that fire a cue — from a desk, a footswitch, a pad or another program. <a href="reference/control.html">The messages</a> Cuerunner sends, the Monitor, and panic.`
    }
  },
  {
    label: 'The showfile',
    free: {
      prose: `<code>.cuerunner</code>, byte-for-byte the same for the same show, with its own history — who saved it, when, which cues moved — plus autosave, recovery and the demo show.`
    }
  },
  {
    label: 'The log',
    free: {
      prose: `What fired, what failed and why, filterable, alongside the show's own events.`
    }
  }
]

/**
 * What a key turns on: one row per capability, in the three columns a buyer reads. The free
 * cell is what stays free beside the Pro column — a class the record holds free, or a line to
 * say there is nothing of this capability without a key.
 */
export const PRO_ROWS = [
  {
    label: 'Scenes and the desk',
    free: {
      identifiers: ['midi:sendTcp'],
      prose: `A one-off message to the desk, when you send it yourself.`
    },
    pro: {
      identifiers: ['midi-tcp', 'sq-native'],
      cues: ['scene'],
      notYetProved: 'Allen &amp; Heath SQ or Avantis',
      prose: `The Scenes view — the show's faders against its scenes — and the scene cue: it writes a scene's membership and each mic's mute, so the show moves an ETC Eos desk or an Allen &amp; Heath SQ or Avantis ${NOT_YET_PROVED} as one of its own steps. Plus the desk link that lets the desk's keys walk the show.`
    }
  },
  {
    label: 'Radio mics',
    free: {
      prose: '—'
    },
    pro: {
      identifiers: ['rf', 'show:ewdx-set-password', 'show:ewdx-trust-again'],
      cues: ['mic'],
      prose: `Battery and RF for every transmitter, in the Monitor and the mic plot; a check before the doors that every pack is ready; alarms when a pack or an aerial misbehaves; the session report afterwards, with what was playing when a pack had trouble. Reads Sennheiser EW-DX receivers directly, any other receiver over a telemetry document, or the demo rack on the bench. A Mic cue mutes or unmutes an EW-DX mic from the cue list.`
    }
  },
  {
    label: 'Lighting',
    free: {
      prose: `MSC and OSC cues to a lighting desk that runs the lights itself.`
    },
    pro: {
      identifiers: ['dmx'],
      cues: ['light'],
      prose: `sACN and Art-Net out of this machine: a fixture patch with clash warnings and identify, fixture types read from Open Fixture Library and GDTF files, groups, faders to build a look and record it, and Light cues that fade it with tracking — latest or highest takes precedence — plus chases and sine effects. A console on the network can be watched or merged in, and Art-Net nodes found.`
    }
  },
  {
    label: 'The script',
    free: {
      identifiers: ['script:readFile'],
      cues: ['script'],
      prose: `Script cues — JavaScript, with the show's own helpers.`
    },
    pro: {
      identifiers: ['script:readDocument', 'script:pickFile', 'companion'],
      prose: `The script panel beside the cue stack, and the read-only tablet view over the local network for the person calling the show.`
    }
  },
  {
    label: 'The second machine',
    free: {
      prose: '—'
    },
    pro: {
      identifiers: ['redundancy', 'redundancy:configure'],
      prose: `Redundant playback: a live and a standby machine, a heartbeat over the network, and a takeover that keeps the position — with the licence that lets both machines run.`
    }
  },
  {
    label: 'The showfile',
    free: {
      prose: `Its own history, readable anywhere.`
    },
    pro: {
      identifiers: ['workspace:compare', 'workspace:merge', 'workspace:exportBundle', 'workspace:importBundle'],
      prose: `Comparing this show with another version of it, merging two people's copies, and the <code>.cuerunnerx</code> bundle that carries the show and its media as one file.`
    }
  },
  {
    label: 'Timecode',
    free: {
      prose: '—'
    },
    pro: {
      identifiers: ['timecode', 'timecode:generate'],
      cues: ['timecode'],
      prose: `SMPTE timecode in and out: follow MTC, LTC or Art-Net with the cue list firing on its frames and chasing a locate, and run a clock of its own — MTC, LTC and Art-Net at once, or jam-synced to the incoming one.`
    }
  },
  {
    label: 'The network',
    free: {
      prose: '—'
    },
    pro: {
      identifiers: ['presence'],
      notYetProved: 'the devices that announce themselves',
      prose: `Finding the devices that announce themselves ${NOT_YET_PROVED} — Dante endpoints among them — and warning when one drops off.`
    }
  }
]

/**
 * Every Pro statement the served tree carries, one entry per `class="pro"` chip: the page under
 * `website/`, the words the chip sits on, and the record's own identifiers — or the Pro cue types
 * — those words claim. A chip is what a buyer reads ("this is Pro") and the ids are what makes it
 * checkable: scripts/pro-page.test.ts walks the served tree, holds this list and the walk to each
 * other both ways, and reads every claim against `capability-catalog.md`, so a chip added, dropped
 * or moved onto a free feature fails the build rather than shipping.
 *
 * The marks outlive the page that renders them — `website/redundancy.html` is hand-written and no
 * module generates it — so the pairing of words with class is written down here, where both the
 * generated and the hand-written pages answer for it.
 */
export const PRO_MARKS = [
  {
    page: 'guides/cue-list.html',
    words: 'Scene',
    cues: ['scene']
  },
  {
    page: 'guides/desk.html',
    words: 'Scenes and the desk',
    identifiers: ['midi-tcp', 'sq-native'],
    cues: ['scene']
  },
  {
    page: 'guides/script.html',
    words: 'Following the script',
    identifiers: ['script:readDocument', 'script:pickFile']
  },
  {
    page: 'guides/showfile.html',
    words: 'Versions and handover',
    identifiers: ['workspace:compare', 'workspace:merge', 'workspace:exportBundle', 'workspace:importBundle']
  },
  {
    page: 'guides/wireless.html',
    words: 'Watching the radio mics',
    identifiers: ['rf']
  },
  {
    page: 'redundancy.html',
    words: 'Redundant playback',
    identifiers: ['redundancy']
  },
  {
    page: 'reference/control.html',
    words: 'Scene cue',
    cues: ['scene']
  },
  {
    page: 'reference/cue-types.html',
    words: 'Scene',
    cues: ['scene']
  },
  {
    page: 'reference/cue-types.html',
    words: 'Mic',
    cues: ['mic']
  },
  {
    page: 'reference/control.html',
    words: 'Mic cue',
    cues: ['mic']
  },
  {
    page: 'guides/cue-list.html',
    words: 'Light',
    cues: ['light']
  },
  {
    page: 'guides/lighting.html',
    words: 'Lighting from the cue list',
    identifiers: ['dmx'],
    cues: ['light']
  },
  {
    page: 'reference/cue-types.html',
    words: 'Light',
    cues: ['light']
  },
  {
    page: 'reference/control.html',
    words: 'Light cue',
    cues: ['light']
  },
  {
    page: 'guides/cue-list.html',
    words: 'Timecode',
    cues: ['timecode']
  },
  {
    page: 'guides/console.html',
    words: 'Following timecode',
    identifiers: ['timecode'],
    cues: ['timecode']
  },
  {
    page: 'reference/cue-types.html',
    words: 'Timecode',
    cues: ['timecode']
  },
  {
    page: 'reference/control.html',
    words: 'Timecode',
    identifiers: ['timecode']
  },
  {
    page: 'reference/control.html',
    words: 'Timecode cue',
    cues: ['timecode'],
    identifiers: ['timecode:generate']
  },
  {
    page: 'reference/formats.html',
    words: 'The bundle file',
    identifiers: ['workspace:exportBundle', 'workspace:importBundle']
  },
  {
    page: 'reference/settings.html',
    words: 'Find devices',
    identifiers: ['presence']
  },
  {
    page: 'reference/settings.html',
    words: 'Tablet view',
    identifiers: ['companion']
  },
  {
    page: 'reference/settings.html',
    words: 'Wireless',
    identifiers: ['rf']
  }
]

/**
 * The four things the hero note names as Cuerunner Pro, each with the record's identifiers behind
 * it: "Cuerunner Pro is the desk, the radios, the tablet and the second machine." The note states
 * the free/Pro line on the landing page, and `website/index.html` is hand-written, so the words
 * and the classes they stand on are declared here and the guard holds the note to them. A noun
 * stands on every service it takes to keep it: the desk is the MIDI link *and* the SQ's own
 * control service, and a list left empty is a Pro statement with nothing behind it.
 */
export const HERO_NOUNS = [
  { noun: 'the desk', identifiers: ['midi-tcp', 'sq-native'] },
  { noun: 'the radios', identifiers: ['rf'] },
  { noun: 'the tablet', identifiers: ['companion'] },
  { noun: 'the second machine', identifiers: ['redundancy'] }
]
