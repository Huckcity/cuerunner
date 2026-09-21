// The comparison page: what the free app is, and what a key turns on.
//
// Generated like the rest of the site so there is one place to keep it true. The app's own
// gates are the authority — ShowService.pro in the main process, and the ProLock surfaces
// in the window — and this page follows them; when the line moves, it moves here in the
// same change.
//
// The two tables are declared rows rather than markup: a row carries the words a buyer reads
// and the record's own identifiers behind them, and scripts/pro-page.test.ts reads that
// declaration against `capability-catalog.md` — every identifier a free column names classed
// free there, every one a Pro column names classed Pro, and every Pro class the record holds
// named by some row. A class this page leaves out, or sells the wrong way round, fails the
// build rather than the buyer.
import { table } from './table.mjs'

/**
 * The phrase a claim carries where nothing in this project has exercised it: a claim is only
 * as strong as the lane that ran (AD-24). This page makes four that no lane does — hosting a
 * real driver, the Allen & Heath desks, show control end to end, and live discovery — and each
 * one says so in its own wording, inline, rather than in a section or a badge.
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
const FREE_CUES = ['audio', 'MIDI', 'OSC', 'MSC', 'network', 'script', 'wait', 'fade', 'stop', 'group', 'devamp']

/** How a count reads at the head of a sentence: "Eleven cue types". Past the last word, the numeral stands. */
const COUNT = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve']

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
      notYetProved: 'hosting a real driver',
      prose: `Every output the interface has, one device at a time, hosting a real driver ${NOT_YET_PROVED}: WASAPI shared and exclusive, ASIO, Core Audio, ALSA and JACK. Sample-accurate scheduling, per-cue level and pan, a crosspoint routing matrix, fades and loops, streaming for long files, and honest numbers when something goes wrong.`
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
      prose: `OSC, MIDI and show-control messages ${NOT_YET_PROVED} that fire a cue, whether they come from a desk, a footswitch, a pad or another program; <a href="reference/control.html">the messages</a> Cuerunner sends; the Monitor, which shows what arrived; and panic.`
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
      identifiers: ['midi-tcp'],
      cues: ['scene'],
      notYetProved: 'Allen &amp; Heath SQ or Avantis',
      prose: `The Scenes view and the scene cue, so the show can move an ETC Eos desk or an Allen &amp; Heath SQ or Avantis ${NOT_YET_PROVED} as one of its own steps, and the desk link that lets the desk's keys walk the show.`
    }
  },
  {
    label: 'Radio mics',
    free: {
      prose: '—'
    },
    pro: {
      identifiers: ['rf'],
      prose: `Every transmitter's battery and RF level in the Monitor and the mic plot, alarms when a pack or an aerial misbehaves, and the session report afterwards. Reads the receivers over a telemetry document or, on the bench, the demo rack.`
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

export const PRO = [
  {
    path: 'pro.html',
    title: 'Free and Pro',
    blurb: 'The free app runs a show: the cue stack, the engine, the ears and the file. Cuerunner Pro runs a production — the desk, the radios, the tablet, the second machine and the handover.',
    body: `
    <section class="panel reveal">
      <h1>Free and Pro</h1>
      <p class="doc-lede">
        Nothing about running a show is behind a key. The free app plays the sound, drives
        the rig, fires from a footswitch and shows you what arrived. Cuerunner Pro is the
        show <em>around</em> it: the desk, the radios, the tablet, the second machine and
        the handover.
      </p>
    </section>

    <section class="panel reveal delay-1">
      <h2>The free half</h2>
      <p>
        No key, no account, no expiry, on as many of your own machines as you like.
        Nothing is taken away from it later, and the file it writes opens anywhere.
      </p>
${table(['What you get', 'Details'], FREE_ROWS.map(row => [row.label, row.free.prose]))}
    </section>

    <section class="panel reveal delay-2">
      <h2>What a key turns on</h2>
      <p>
        Pro is what a production needs once there is more than one person, more than one
        machine, or a radio mic in the room.
      </p>
${table(['Capability', 'Free', 'Pro'], PRO_ROWS.map(row => [row.label, row.free.prose, row.pro.prose]))}
    </section>

    <section class="panel reveal delay-3">
      <h2>The key</h2>
      <ul>
        <li>Signed, and checked on the machine — nothing phones home, and nothing needs an account.</li>
        <li><strong>A key ends when it ends.</strong> The Pro half stops on that machine the moment the last day is out — the Pro services first, the desk link among them, and scene cues refused from then on — while nothing already playing is interrupted and the free half keeps working. A pair set to take over by itself hands the show to the standby when the machine that ran out goes quiet; keeping the standby licensed is what makes that work.</li>
        <li>Not tied to one computer: the machine you run from and the one standing by.</li>
        <li>Deactivate it and that machine is back to the free half.</li>
        <li>A show written with Pro opens anywhere. Its scenes, its mic plot and its triggers travel with the file even on a machine that has no key — only the surfaces and the services wait for one.</li>
        <li>Enter a renewed key and the Pro half comes back on the spot, with no restart.</li>
      </ul>
      <p class="note">
        What Cuerunner does not do is play the video. Another program owns the projection
        and Cuerunner tells it when to roll; that boundary is deliberate, and it is how the
        room keeps one clock — <a href="interop.html">working with other programs</a> shows
        the wiring.
      </p>
    </section>
`
  }
]
