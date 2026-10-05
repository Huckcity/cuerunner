// The reference: pages you look something up in.
//
// Tables, field by field, with defaults. No walkthroughs — a page here answers "what does
// this field do" and "what exactly does it send", and links back to the guide that shows
// it being used.
//
// The settings page is the one page here that documents another window, so the two sides are
// declared rather than left to drift: `SETTINGS_SECTIONS` names the settings tab each section
// answers to, and `LICENSE_ROWS`/`LICENSE_KEY_ROWS`/`CHANNELS_ROWS` state the rows of the License
// tab and the controls of the Show Settings → Channels tab. All of them are read back by
// `scripts/reference-page.test.ts` — the sections against the app's own `SETTINGS_TABS`, the rows
// against the labels `LicenseSection.tsx` and `ChannelsTab.tsx` print — so a tab the app adds, a
// section that answers to no tab, and a row label that moves all fail the build.
import { table } from './table.mjs'

/**
 * The settings page's sections, one per tab of the app's Settings dialog, in the order the dialog
 * shows them: the tab's own id, and the anchor this page gives its section. Each section's heading
 * is the tab's own label — `SettingsDialog.tsx`'s `SETTINGS_TABS` — and the guard holds the two
 * lists both ways, so a tab with no section and a section answering to a tab the app does not
 * declare are both failures. The Show Settings block further down is not in this list: it
 * documents the show's own dialog, which is not a tab of the settings dialog.
 */
export const SETTINGS_SECTIONS = [
  { tab: 'general', anchor: 'general' },
  { tab: 'audio', anchor: 'audio' },
  { tab: 'midi', anchor: 'midi' },
  { tab: 'network', anchor: 'network' },
  { tab: 'wireless', anchor: 'wireless' },
  { tab: 'redundancy', anchor: 'backup' },
  { tab: 'license', anchor: 'license' }
]

/**
 * The tab's own blurb, as the app writes it beside the tab's name (`TAB_BLURB.license` in
 * `SettingsDialog.tsx`): the reader this page is written for reads exactly that line under the
 * sidebar, so the section opens with it and `scripts/reference-page.test.ts` holds the two to
 * each other.
 */
export const LICENSE_BLURB = 'Cuerunner Pro on this machine.'

/**
 * The License tab on a licensed machine: the rows `LicenseSection.tsx` prints, in the order it
 * prints them, with what each one is reading. The labels are the app's own words for those rows —
 * the guard reads each back out of the component — so the page a reader is sent to documents the
 * rows they will find, named as the tab names them.
 */
export const LICENSE_ROWS = [
  {
    label: 'License',
    prose: `Who the key is licensed to, as the issuer wrote it.`
  },
  {
    label: 'Key id',
    prose: `The key's own id, as the issuer minted it — what a question about this key is answered by.`
  },
  {
    label: 'Issued',
    prose: `The day the key was issued.`
  },
  {
    label: 'Expires',
    prose: `The last day it runs, or <code>never</code> for a key with no end date.`
  },
  {
    label: 'Deactivate',
    prose: `A button that takes the key off this machine: it goes back to the free half, and the shows are untouched.`
  }
]

/**
 * The License tab before a key is entered: the field, and the button that checks what is in it. A
 * key that has run out leaves the Pro half off until a renewed one is entered, which is the state
 * the tab says out loud — the cue stack and the shows keep working either way.
 */
export const LICENSE_KEY_ROWS = [
  {
    label: 'License key',
    prose: `The field a key is pasted into. It is checked on this machine, so a show computer never needs the internet.`
  },
  {
    label: 'Activate',
    prose: `Checks what is in the field and turns the Pro half on the spot. A key that is refused says why, under the field.`
  }
]

/**
 * The Show Settings → Channels tab, control by control: the labels `ChannelsTab.tsx` prints, in
 * the order it prints them, and what each one sets. A field the tab prints in two branches — a
 * host for the OSC connection and one for a TCP desk — is named once, where the tab first prints
 * it. The guard reads each label back out of the component, so the tab a reader is sent to is
 * documented under the words the operator finds its controls under.
 */
export const CHANNELS_ROWS = [
  {
    label: 'Model',
    prose: `Which desk this is — any desk's note on and note off, an SQ, or an Avantis — and so what the desk takes as an open and a close.`
  },
  {
    label: 'Host',
    prose: `The desk's address, the one thing nobody can guess.`
  },
  {
    label: 'Port',
    prose: `The desk's MIDI-over-TCP port, 51325 on an SQ and on an Avantis, or the port an OSC desk's addresses are sent to.`
  },
  {
    label: 'Address',
    prose: `The OSC address a fader is sent to, with <code>{n}</code> standing for its number.`
  },
  {
    label: 'Channel',
    prose: `The MIDI channel the desk's own MIDI is set to — <em>Utility → General → MIDI</em> on an SQ.`
  },
  {
    label: 'GO button',
    prose: `The mute group the operator's GO key is assigned to at the desk, or <em>no GO button</em> for a show run from the window.`
  },
  {
    label: 'BACK button',
    prose: `The mute group the operator's BACK key is assigned to.`
  },
  {
    label: 'GO note',
    prose: `The MIDI note the operator's GO key transmits, for a soft key set to MIDI Note — a press that steps the show once and leaves nothing lit. Offered on an SQ, whose own traffic cannot be a note.`
  },
  {
    label: 'BACK note',
    prose: `The MIDI note the operator's BACK key transmits.`
  },
  {
    label: 'Count',
    prose: `Sizes the list beside it: the strips under the Channels heading, the faders under the DCAs one. A shorter count drops the last of them.`
  },
  {
    label: 'Allow a channel to ride more than one fader',
    prose: `The rule the Scenes grid follows: on, a strip rides as many faders as a scene places it on; off, the grid keeps one fader per channel and a recall folds a leftover down to the lowest-numbered one.`
  },
  {
    label: 'Highest fader wins',
    prose: `An SQ adds every DCA a channel is on, so one of its faders at -inf silences it. On, a channel a scene places on several faders rides only the highest of them, and Cuerunner moves it as the faders cross; a muted DCA counts as -inf. Offered on an SQ over the network with the rule above on, and off until asked for.`
  }
]

export const REFERENCE = [
  {
    path: 'reference/index.html',
    title: 'Reference',
    blurb: 'Every cue type and field, every setting, the keyboard table, the OSC and MIDI messages Cuerunner answers to, the script helpers and the file formats.',
    body: `
    <section class="panel reveal">
      <h1>Reference</h1>
      <p class="doc-lede">
        Looked up rather than read through. For how to do a thing, start with the
        <a href="../guide.html">guides</a>.
      </p>
    </section>

    <section class="panel reveal delay-1">
      <div class="cards two-col doc-cards">
        <a class="card doc-card" href="./cue-types.html">
          <h3>Cue types</h3>
          <p>All twelve types, every field, and what each one defaults to.</p>
        </a>
        <a class="card doc-card" href="./settings.html">
          <h3>Settings</h3>
          <p>Every option in Settings and Show Settings, and where each is saved.</p>
        </a>
        <a class="card doc-card" href="./keyboard.html">
          <h3>Keyboard</h3>
          <p>Every shortcut, and where it works.</p>
        </a>
        <a class="card doc-card" href="./control.html">
          <h3>OSC &amp; MIDI control</h3>
          <p>What Cuerunner listens for, what a trigger matches, and what a cue sends.</p>
        </a>
        <a class="card doc-card" href="./script-api.html">
          <h3>Script cue API</h3>
          <p><code>shell()</code>, <code>include()</code>, timeouts and what a script may touch.</p>
        </a>
        <a class="card doc-card" href="./formats.html">
          <h3>File formats</h3>
          <p>The <code>.cuerunner</code> workspace, media paths, and the wireless telemetry document.</p>
        </a>
        <a class="card doc-card" href="./troubleshooting.html">
          <h3>Troubleshooting</h3>
          <p>Symptom, cause, fix — and the known limitations.</p>
        </a>
      </div>
    </section>
`
  },

  {
    path: 'reference/cue-types.html',
    section: 'Reference',
    title: 'Cue types',
    blurb: 'Every Cuerunner cue type and every field it carries, with defaults.',
    body: `
    <section class="panel reveal">
      <h1>Cue types</h1>
      <p class="doc-lede">
        Twelve types. Every one of them carries the common fields below, and then its own.
      </p>
    </section>

    <section class="panel reveal delay-1" id="common">
      <h2>Every cue</h2>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Field</th><th>Default</th><th>What it does</th></tr></thead>
          <tbody>
            <tr><td>Number</td><td>next free</td><td>Text, not a position. <code>12.5</code> and <code>LX 12</code> are both valid, and inserting a cue renumbers nothing.</td></tr>
            <tr><td>Name</td><td>the type</td><td>What you read at speed.</td></tr>
            <tr><td>Colour</td><td>none</td><td>A stripe down the row's edge. Eight colours.</td></tr>
            <tr><td>Notes</td><td>empty</td><td>The first line shows in the live/next bar when the cue is playing or next.</td></tr>
            <tr><td>Pre-wait</td><td>0 s</td><td>Waits this long after GO before the cue acts.</td></tr>
            <tr><td>Post-wait</td><td>0 s</td><td>Waits this long after the cue finishes before handing over.</td></tr>
            <tr><td>Advance</td><td>None</td><td><strong>None</strong>, <strong>On start</strong> (fire the next cue as soon as this one starts) or <strong>On end</strong> (when it finishes).</td></tr>
            <tr><td>If fired again</td><td>Leave it running</td><td>What a second GO does while the cue runs: leave it, or restart it.</td></tr>
            <tr><td>Armed</td><td>on</td><td>A disarmed cue is skipped by GO and ignores its triggers.</td></tr>
            <tr><td>Triggers</td><td>none</td><td>OSC, MIDI or show-control messages that fire this cue. See <a href="./control.html">control</a>.</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="panel reveal delay-1" id="audio">
      <h2>Audio</h2>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Field</th><th>Default</th><th>What it does</th></tr></thead>
          <tbody>
            <tr><td>File</td><td>—</td><td>WAV, AIFF, FLAC, MP3, M4A, OGG. A file at another sample rate is resampled as it plays; pitch and tempo are unchanged.</td></tr>
            <tr><td>Start time / End time</td><td>0 / end of file</td><td>The part of the file this cue plays. Draggable on the waveform.</td></tr>
            <tr><td>Trim silence</td><td>off</td><td>Starts at the first sound in the file and ends at the last, where silence is anything below −60 dBFS. Never rewrites the region you set: turning it off plays the whole region again.</td></tr>
            <tr><td>Fade in</td><td>0 s</td><td>Ramps up from silence over this long when the cue starts.</td></tr>
            <tr><td>Volume</td><td>100%</td><td>The cue's own level, applied to every output.</td></tr>
            <tr><td>Pan</td><td>centre</td><td>−1 to 1. Automatic routing spreads it across the pair.</td></tr>
            <tr><td>Rate</td><td>1.00×</td><td>Playback speed, 0.25× to 4×.</td></tr>
            <tr><td>Loop count</td><td>0</td><td><code>0</code> plays once, <code>n</code> repeats n more times, <code>-1</code> loops for ever — a vamp, released by a devamp cue.</td></tr>
            <tr><td>Routing</td><td>Automatic</td><td><strong>Automatic</strong> (channels in order), <strong>Matrix</strong> (crosspoints with gains) or <strong>Silent</strong> (runs, sends nothing).</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="panel reveal delay-2" id="timing">
      <h2>Wait, Fade, Stop and Devamp</h2>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Type</th><th>Fields</th></tr></thead>
          <tbody>
            <tr>
              <td><strong>Wait</strong></td>
              <td><strong>Duration</strong>. Holds for that long. Set Advance to On end to fire the next cue afterwards.</td>
            </tr>
            <tr>
              <td><strong>Fade</strong></td>
              <td><strong>Target</strong> (a cue), <strong>Property</strong> (volume or pan), <strong>Target value</strong>, <strong>Duration</strong>, <strong>Curve</strong> (linear, S-curve, logarithmic) and <strong>Stop when done</strong> — which makes it a fade-out.</td>
            </tr>
            <tr>
              <td><strong>Stop</strong></td>
              <td><strong>Target</strong> (a cue, or All cues), <strong>Fade out</strong> with a <strong>duration</strong>, and <strong>Wait for fade</strong>, which holds the show until the fade has finished instead of completing as soon as the target is told to stop.</td>
            </tr>
            <tr>
              <td><strong>Devamp</strong></td>
              <td><strong>Target</strong> — a looping audio cue. It finishes the lap it is on and plays out to the end of its file.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="panel reveal delay-2" id="group">
      <h2>Group</h2>
      <p>Cues inside a cue. <strong>Mode</strong> decides what GO does with them:</p>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Mode</th><th>What happens</th></tr></thead>
          <tbody>
            <tr><td>Sequence</td><td>Children in order, each after the one before.</td></tr>
            <tr><td>All at once</td><td>Every child together.</td></tr>
            <tr><td>Random</td><td>One child, chosen at random.</td></tr>
            <tr><td>Timeline</td><td>Each child at its own offset, edited by dragging in the dock.</td></tr>
          </tbody>
        </table>
      </div>
      <p>
        A group's duration is worked out from its children. Stopping a group stops them
        too.
      </p>
    </section>

    <section class="panel reveal delay-3" id="messages">
      <h2>MIDI, OSC, Network and Show Control</h2>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Type</th><th>Fields</th></tr></thead>
          <tbody>
            <tr>
              <td><strong>MIDI</strong></td>
              <td><strong>Port</strong> (or the show's default output) and a list of messages: note on, note off, control change, program change, or raw sysex bytes.</td>
            </tr>
            <tr>
              <td><strong>OSC</strong></td>
              <td><strong>Host</strong>, <strong>Port</strong>, <strong>Address</strong>, and arguments typed as integer, float, string, true or false.</td>
            </tr>
            <tr>
              <td><strong>Network</strong></td>
              <td><strong>Method</strong> (GET, POST, PUT), <strong>URL</strong>, <strong>Headers</strong>, <strong>Body</strong> and <strong>Timeout</strong> (5000 ms). The cue finishes when the server answers or the timeout runs out; the result is on its Last run.</td>
            </tr>
            <tr>
              <td><strong>Show Control</strong></td>
              <td>MSC. <strong>Send on</strong> the show's desk connection or a MIDI port, a <strong>command</strong> (Go, Stop, Resume, Load…), the equipment <strong>format</strong>, a <strong>device ID</strong> (127 reaches everything), and a <strong>cue</strong> and <strong>list</strong> where the command carries them.</td>
            </tr>
            <tr>
              <td><strong>Script</strong></td>
              <td><strong>Script</strong> and <strong>Timeout</strong> (60000 ms; 0 waits for ever). See the <a href="./script-api.html">script API</a>.</td>
            </tr>
            <tr>
              <td><strong>Mic</strong><span class="pro">Pro</span></td>
              <td><strong>Mic</strong> — the Sennheiser EW-DX channel to act on, chosen from the packs the show knows (named by the plot and who is wearing the pack, or by what the receiver calls it), and <strong>Do</strong>: <strong>Mute</strong> or <strong>Unmute</strong>. There is no toggle, because a toggle run twice leaves the mic as the first run found it, and a cue list that can be jumped around in cannot know which that was. The receiver is asked afterwards: a mute that did not happen is an error on the cue, in the log and on its row, never a mic left open in silence. With no mic chosen the cue does nothing and says so.</td>
            </tr>
            <tr>
              <td><strong>Scene</strong><span class="pro">Pro</span></td>
              <td><strong>Scene</strong> — the one to recall. It answers for the whole show rather than for its placements: a channel the scene leaves off every fader is closed by the recall. Two facts go out, in this order — the <strong>membership</strong> (the channels the scene places on each fader, and the faders it takes them off) and then each mic's <strong>mute</strong> — and no message names a channel outside the show's own set. A mute carries the channel's own number, never a fader's. The membership goes over the route the desk takes it on — an SQ's own control service on TCP 51326, an Avantis's NRPN <code>40</code> on the desk link — and a desk with no such route reports the gap while the mutes go anyway. With no scene chosen the cue does nothing.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
`
  },

  {
    path: 'reference/settings.html',
    section: 'Reference',
    title: 'Settings',
    blurb: 'Every setting in Cuerunner, what it does, and whether it is saved with the show or with the computer.',
    body: `
    <section class="panel reveal">
      <h1>Settings</h1>
      <p class="doc-lede">
        <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>,</kbd>, or Cuerunner ▾ → Settings…, whose sidebar
        splits them by where they are kept: <strong>this show</strong> travels in the
        <code>.cuerunner</code> file, <strong>this computer</strong> stays on the machine.
      </p>
    </section>

    <section class="panel reveal delay-1" id="general">
      <h2>General</h2>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Setting</th><th>Default</th><th>What it does</th></tr></thead>
          <tbody>
            <tr><td>Repeat guard</td><td>300 ms</td><td>Ignores a second GO arriving this soon after the first, from the space bar, a trigger or a console. 0 turns it off.</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="panel reveal delay-1" id="audio">
      <h2>Audio</h2>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Setting</th><th>Default</th><th>What it does</th></tr></thead>
          <tbody>
            <tr><td>Audio system</td><td>the platform's own</td><td>Which audio system drives the show: the platform's own, or ASIO on Windows, which drives an interface through its own driver rather than the system mixer.</td></tr>
            <tr><td>Output device</td><td>system default</td><td>Where the show plays.</td></tr>
            <tr><td>Sample rate</td><td>device default</td><td>What the engine runs at. Files at other rates are resampled.</td></tr>
            <tr><td>Buffer</td><td>engine default</td><td>Frames per block: lower is tighter, higher is safer.</td></tr>
            <tr><td>Channels</td><td>device default</td><td>How many outputs the device offers the routing matrix.</td></tr>
            <tr><td>Exclusive</td><td>off</td><td>Keeps other apps off the device, for every channel it has and steadier timing. A driver that refuses says why.</td></tr>
            <tr><td>Trim silence</td><td>off</td><td>A default for new audio cues, not a switch over the show. Cues already in the list keep the trim they were made with.</td></tr>
          </tbody>
        </table>
      </div>
      <p>
        Under them, what the engine is actually doing: backend, rate, device, latency,
        voices playing, media memory, and any dropouts. That block is a reading, not a
        setting. Under it sits <strong>Reconnect device</strong>, which sends the show's
        settings to the engine again so a device it lost is reopened — a no-op while the
        device is already running them, and the way back once the interface is plugged in
        again. It is disabled while the engine runs a backend with no device at all, where
        a device request can only be refused.
      </p>
    </section>

    <section class="panel reveal delay-2" id="midi">
      <h2>MIDI</h2>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Setting</th><th>Default</th><th>What it does</th></tr></thead>
          <tbody>
            <tr><td>Send on</td><td>none</td><td>The port MIDI cues use unless they name their own.</td></tr>
            <tr><td>Listen to MIDI</td><td>off</td><td>Opens the input ports you tick — all of them if you tick none — so cues can fire from notes and controllers.</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="panel reveal delay-2" id="network">
      <h2>Network</h2>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Setting</th><th>Default</th><th>What it does</th></tr></thead>
          <tbody>
            <tr><td>OSC control</td><td>on, port 53000</td><td>Takes cues and commands from consoles, desks and tablets. A port another program holds is reported rather than taken.</td></tr>
            <tr><td>Find devices<span class="pro">Pro</span></td><td>off</td><td>Lists gear that announces itself on the network — Dante endpoints among them — in the Monitor, and warns when one drops off.</td></tr>
            <tr><td>↳ Service types</td><td><code>_netaudio-arc._udp.local</code>, <code>_netaudio-cmc._udp.local</code></td><td>Under Advanced. What to browse for.</td></tr>
            <tr><td>↳ Gone after</td><td>30 s</td><td>Under Advanced. How long a device can go unseen before it counts as gone.</td></tr>
            <tr><td>Tablet view<span class="pro">Pro</span></td><td>off, port 53100</td><td>Serves a read-only view of the show on the local network. An access code is required; anyone without it is refused.</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="panel reveal delay-2" id="wireless">
      <h2>Wireless<span class="pro">Pro</span></h2>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Setting</th><th>Default</th><th>What it does</th></tr></thead>
          <tbody>
            <tr><td>Sources</td><td>none</td><td>Where readings come from: a Sennheiser EW-DX receiver, an HTTP address, a file on disk, or the demo rack. An EW-DX source takes the receiver's address and its password, receivers on the network are found and offered, and a receiver whose address changes is found again by its serial; the others read <a href="./formats.html#telemetry">the document format</a>.</td></tr>
            <tr><td>Battery below</td><td>25%</td><td>Warns at this level.</td></tr>
            <tr><td>Battery urgent</td><td>10%</td><td>Raises an alarm at this level.</td></tr>
            <tr><td>Signal below</td><td>−75 dBm</td><td>Warns when RF is weaker than this.</td></tr>
            <tr><td>Pack silent for</td><td>6 s</td><td>How long a pack that has reported can go quiet before it counts as offline.</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="panel reveal delay-3" id="backup">
      <h2>Backup machine</h2>
      <p>Kept on the computer, not in the show. The <a href="../redundancy.html">walkthrough</a> has the whole thing.</p>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Setting</th><th>Default</th><th>What it does</th></tr></thead>
          <tbody>
            <tr><td>Redundant playback</td><td>off</td><td>Pairs this computer with another running the same show.</td></tr>
            <tr><td>This computer is</td><td>Live</td><td><strong>Live</strong> runs the show; <strong>Standby</strong> follows it.</td></tr>
            <tr><td>Called</td><td>machine name</td><td>What the pair calls this computer in its status and log lines.</td></tr>
            <tr><td>If the other one stops</td><td>Tell me</td><td>Or take the show over by itself.</td></tr>
            <tr><td>↳ Ports, address, access code</td><td>53110</td><td>Under Advanced. The access code must match on both computers; without one, any machine that finds the port can claim the pair.</td></tr>
            <tr><td>↳ Gone after</td><td>3000 ms</td><td>Under Advanced. Silence before the partner counts as gone.</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="panel reveal delay-3" id="license">
      <h2>License</h2>
      <p>
        ${LICENSE_BLURB} The first table is what a machine is carrying once a key is on it, and
        the second is how a key is entered. Nothing on the tab is needed to run the free half,
        and nothing is asked of the network — the key is checked on the machine it is entered on,
        so a venue with no internet unlocks exactly like any other.
      </p>
${table(['Row', 'What it shows'], LICENSE_ROWS.map(row => [row.label, row.prose]))}
      <p>
        A key that has run out leaves the Pro half off until a renewed one is entered, and the
        tab says which day it ran out. The cue stack and the shows keep working either way.
      </p>
${table(['Row', 'What it does'], LICENSE_KEY_ROWS.map(row => [row.label, row.prose]))}
    </section>

    <section class="panel reveal delay-3" id="show">
      <h2>Show Settings</h2>
      <p>
        The settings under Cuerunner ▾ → Show Settings… are the show's own, and travel in
        the file.
      </p>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Tab</th><th>What is on it</th></tr></thead>
          <tbody>
            <tr><td>Channels</td><td>The desk connection — OSC, MIDI or MIDI over TCP, with its address, the MIDI-over-TCP port being 51325 as an SQ and an Avantis both serve it — the channel strips on the console and the faders the show drives, each with a Count beside its heading that sizes the list. An SQ is opened on its own control service as well — TCP 51326 outbound, kept alive with a datagram to the desk's UDP 51324 — because its MIDI service carries the mutes and nothing else: the membership has no route there. A shorter strip count drops the last strips, which leaves every scene and unpatches whoever was on them; a shorter fader count drops the last faders and takes every scene's row for those places with them, and unpatches nobody. A strip is a name and a number — the per-channel fader select this tab used to carry is deleted, not deprecated — and which fader it rides is the scene's decision, made in the Scenes grid, so a show sets up its channels and its faders here and places them scene by scene. Each fader carries one desk number, for a desk that counts its DCAs differently from the show. Under the faders, Allow a channel to ride more than one fader is the rule the grid follows: off, placing a strip on a row takes it off that scene's other rows, and a recall folds whatever a file still carries down to the lowest-numbered fader. Beside it, Highest fader wins — an SQ over the network only — keeps a channel on several faders on the highest of them: Cuerunner reads the SQ's DCA masters on the MIDI service, 51325, asks where they stand when it first needs them, and moves the channel's membership as one fader overtakes another, between recalls as well as at them. Changes made at the desk to a channel's DCA assignment are not seen, so a show using it leaves assignment to Cuerunner. The line under the connection reads back exactly what will be sent, and names a show larger than the desk model states, with the number of inputs it exceeded. A recall that fails says which failure it was: nothing answered at that address, or the desk took the connection and reset it. The second is what a desk whose MIDI port another program is holding does, and there the address is right.</td></tr>
            <tr><td>Cast</td><td>Performers, their parts, the channel each is on, and any note. Groups are built in the Scenes view, from the strips a row should carry.</td></tr>
            <tr><td>Mic plot</td><td>Packs, the channel each is patched to, and who is wearing it. Changing a performer on a pack records a swap.</td></tr>
          </tbody>
        </table>
      </div>
      <p>
        The Channels tab's own controls, in the order the tab shows them:
      </p>
${table(['Control', 'What it sets'], CHANNELS_ROWS.map(row => [row.label, row.prose]))}
      <p>
        The desk's own buttons are read from the same connection, so they are set up with it: the
        two groups above are the mute groups the operator's GO and BACK keys are assigned to at
        the desk, and the two notes are for soft keys set to MIDI Note — offered on an SQ, whose
        own traffic cannot be a note. An Avantis answers for its keys four channels above its own,
        so a desk set to MIDI channel 13 or higher leaves them past what MIDI has: the fields are
        not drawn there, the show is run from the window, and a recall still sends.
      </p>
    </section>
`
  },

  {
    path: 'reference/keyboard.html',
    section: 'Reference',
    title: 'Keyboard',
    blurb: 'Every Cuerunner keyboard shortcut and where it works.',
    body: `
    <section class="panel reveal">
      <h1>Keyboard</h1>
      <p class="doc-lede">
        Shortcuts are written for the keyboard the app is running on: <kbd>Ctrl</kbd> on
        Windows and Linux, <kbd>⌘</kbd> on macOS.
      </p>
    </section>

    <section class="panel reveal delay-1">
      <h2>Running</h2>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Keys</th><th>Action</th><th>Where</th></tr></thead>
          <tbody>
            <tr><td><kbd>Space</kbd></td><td>GO — fire the next cue</td><td>Anywhere except a text field</td></tr>
            <tr><td><kbd>Esc</kbd></td><td>STOP — stop everything</td><td>Anywhere except a text field. With a menu open, the press closes the menu and stops nothing</td></tr>
            <tr><td><kbd>Shift</kbd> + <kbd>Esc</kbd></td><td>PANIC — stop with a short fade</td><td>Anywhere except a text field</td></tr>
            <tr><td><kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>Shift</kbd> + <kbd>P</kbd></td><td>PANIC from the application menu — the same silence, reached without the window</td><td>Anywhere, including while the window is busy</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="panel reveal delay-1">
      <h2>The show file</h2>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Keys</th><th>Action</th></tr></thead>
          <tbody>
            <tr><td><kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>N</kbd></td><td>New workspace</td></tr>
            <tr><td><kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>O</kbd></td><td>Open workspace</td></tr>
            <tr><td><kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>S</kbd></td><td>Save</td></tr>
            <tr><td><kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>Shift</kbd> + <kbd>S</kbd></td><td>Save As…</td></tr>
            <tr><td><kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>,</kbd></td><td>Settings…</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="panel reveal delay-2">
      <h2>Editing the list</h2>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Keys</th><th>Action</th><th>Where</th></tr></thead>
          <tbody>
            <tr><td><kbd>↑</kbd> / <kbd>↓</kbd></td><td>Move the selection</td><td>Cue list</td></tr>
            <tr><td><kbd>Delete</kbd></td><td>Delete the selected cue</td><td>Cue list</td></tr>
            <tr><td><kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>D</kbd></td><td>Duplicate the selected cue</td><td>Cue list</td></tr>
            <tr><td><kbd>Enter</kbd> / <kbd>Esc</kbd></td><td>Commit or cancel a rename</td><td>Renaming a cue</td></tr>
            <tr><td><kbd>Esc</kbd></td><td>Close a menu — the row menu, Cuerunner ▾ or More ▾ — or cancel a rename; a bare press is the transport's</td><td>Cue list and toolbar</td></tr>
            <tr><td><kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>Z</kbd></td><td>Undo</td><td>Anywhere except a text field</td></tr>
            <tr><td><kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>Shift</kbd> + <kbd>Z</kbd></td><td>Redo</td><td>Anywhere except a text field</td></tr>
          </tbody>
        </table>
      </div>
      <div class="note">
        Undo is one stack for everything an edit destroys — the cue list, the scenes, the
        desk setup, the cast and the mic plot — so an undo is never half a change. It
        keeps the last 50 edits. In a focused text field, the field's own undo applies
        instead.
      </div>
    </section>
`
  },

  {
    path: 'reference/control.html',
    section: 'Reference',
    title: 'OSC & MIDI control',
    blurb: 'What Cuerunner listens for, what a cue trigger matches, and what Cuerunner sends to a desk.',
    body: `
    <section class="panel reveal">
      <h1>OSC &amp; MIDI control</h1>
      <p class="doc-lede">
        For setting it up, see <a href="../guides/console.html">firing cues from a
        console</a>. This is the message-level detail.
      </p>
    </section>

    <section class="panel reveal delay-1" id="listening">
      <h2>What Cuerunner listens on</h2>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Input</th><th>Default</th><th>Notes</th></tr></thead>
          <tbody>
            <tr><td>OSC</td><td>UDP port 53000</td><td>Every message is published to the Monitor and the run log with its sender and arguments.</td></tr>
            <tr><td>MIDI</td><td>the ports you tick</td><td>With none ticked, every input is opened. An interface that disappears mid-show is reported, because a cue sending down it would otherwise play nowhere in silence.</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="panel reveal delay-1" id="panic">
      <h2>Panic from anywhere</h2>
      <p>Two messages stop the show whoever sends them, with no cue written for them:</p>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Message</th><th>Effect</th></tr></thead>
          <tbody>
            <tr><td><code>/cuerunner/panic</code> (any arguments)</td><td>Panic: everything stops with a 200 ms fade.</td></tr>
            <tr><td>MIDI All Sound Off — controller 120, value 0, any channel, any listened port</td><td>The same.</td></tr>
          </tbody>
        </table>
      </div>
      <p>
        Both are acted on where the engine is rather than in the window, so the fade starts
        whether or not the interface is answering. The run log records the sender:
        <code>[main] panic (osc): /cuerunner/panic from 192.168.1.24:8000</code>.
      </p>
    </section>

    <section class="panel reveal delay-2" id="triggers">
      <h2>What a trigger matches</h2>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Kind</th><th>Matched on</th><th>Ignored</th></tr></thead>
          <tbody>
            <tr><td>OSC</td><td>The address, exactly.</td><td>Arguments.</td></tr>
            <tr><td>MIDI note</td><td>Port, channel and note number.</td><td>Velocity — a note fires whatever it was played at.</td></tr>
            <tr><td>MIDI control change</td><td>Port, channel and controller number.</td><td>Value.</td></tr>
            <tr><td>MIDI program change</td><td>Port, channel and program number.</td><td>—</td></tr>
            <tr><td>Show control</td><td>Every field the console sent: command, format, device ID, and the cue and list where they are carried.</td><td>—</td></tr>
          </tbody>
        </table>
      </div>
      <p>
        A trigger fires its cue exactly as GO would, pre-wait and advance included. A
        disarmed cue ignores its triggers. The repeat guard (Settings → General) applies to
        triggers as well as to the space bar.
      </p>
    </section>

    <section class="panel reveal delay-2" id="sending">
      <h2>What Cuerunner sends</h2>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Cue</th><th>What goes out</th></tr></thead>
          <tbody>
            <tr><td>OSC cue</td><td>The address and its typed arguments, to the host and port on the cue.</td></tr>
            <tr><td>MIDI cue</td><td>Its list of messages, on the cue's port or the show's default output.</td></tr>
            <tr><td>Show Control cue</td><td>An MSC message: command, equipment format, device ID (127 reaches everything), and cue and list where the command carries them.</td></tr>
            <tr><td>Mic cue<span class="pro">Pro</span></td><td>One request to the receiver: <code>{ "mute": true }</code> or <code>false</code>, for one channel, and nothing else — no name, no gain, no level. Then a read of that channel to confirm it took. Muting a channel that is already muted is not an error; it is the state asked for.</td></tr>
            <tr><td>Scene cue<span class="pro">Pro</span></td><td>The scene's membership first — which channels it places on which faders, and the faders it takes them off — then each mic's mute, for the channels a recall moves and no others. Nothing outside the show's own channels is named: a mute carries the channel's own number, never a fader's, and a channel the scene leaves off every fader is closed. A mic that changes fader is never muted by the move: it keeps playing and takes the new fader's position. The membership goes over the desk's own route — an SQ's control service on TCP 51326, an Avantis's NRPN <code>40</code> on the desk link — and a desk with no membership route reports the gap while the mutes go anyway.</td></tr>
          </tbody>
        </table>
      </div>
      <p>
        The desk a scene cue drives is set up once in Show Settings → Channels, where the
        read-back line says which of the show's channels a recall will touch and what the
        desk it names can be told. What goes out is the difference against what Cuerunner
        last sent, held for the session and never undone, and each write is remembered as it
        lands: there is no read-back of a recall's own writes, so a fader moved by hand at the
        desk is invisible here: recalling a scene again sends only what has changed since the
        last send, and that record lives for as long as the show is open. Reopening the show
        forgets it, and the next recall writes every channel the scene controls.
      </p>
    </section>
`
  },

  {
    path: 'reference/script-api.html',
    section: 'Reference',
    title: 'Script cue API',
    blurb: 'What a Cuerunner script cue can call: shell, include, timeouts, logging and the limits.',
    body: `
    <section class="panel reveal">
      <h1>Script cue API</h1>
      <p class="doc-lede">
        A script cue runs JavaScript on its own worker thread when the cue fires, and holds
        the show until it finishes.
      </p>
    </section>

    <section class="panel reveal delay-1">
      <h2>How it runs</h2>
      <ul class="tight-list">
        <li><code>await</code> works; the cue is not finished until the script is.</li>
        <li>A script that outlasts its <strong>timeout</strong> is stopped and reported as a failure. The default is 60000 ms; <code>0</code> waits for ever.</li>
        <li>STOP, panic, and a stop cue aimed at this one all end it.</li>
        <li>An empty script does nothing and completes at once.</li>
        <li>A script cannot reach the interface. It has the helpers below and nothing else.</li>
        <li><code>console.log()</code> and <code>console.error()</code> write to the run log. One run is capped at 200 lines before it is truncated.</li>
      </ul>
    </section>

    <section class="panel reveal delay-1">
      <h2>Trust</h2>
      <p>
        A workspace file is executable code and network-triggerable: a script cue runs a
        system command as you when it fires, and a network trigger (OSC, MIDI or show
        control) lets one packet on the show network fire any cue, scripts included. Only
        open <code>.cuerunner</code> files you trust, and only on a network you trust — the
        composition is the risk, not either half alone. OSC input listens on all interfaces
        by default.
      </p>
    </section>

    <section class="panel reveal delay-1">
      <h2><code>shell(command, options?)</code></h2>
      <p>Runs a system command and resolves with its result.</p>
      <div class="code"><code>const r = await shell('echo dimmer 80%')
console.log(r.stdout.trim())</code></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Resolves</th><th>Options</th></tr></thead>
          <tbody>
            <tr>
              <td><code>{ stdout, stderr, code, signal }</code></td>
              <td><code>timeout</code> (ms, default 10000), <code>cwd</code>, <code>env</code></td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>Commands start in the workspace's folder.</p>
    </section>

    <section class="panel reveal delay-2">
      <h2><code>include('path/to/file.js')</code></h2>
      <p>
        Runs another JavaScript file and resolves with whatever that file returned, so a
        helper file can hand back values. Each file runs once per cue however many times it
        is included, and an include inside a file resolves relative to that file.
      </p>
      <div class="code"><code>const rig = await include('lib/rig.js')
await rig.blackout()</code></div>
    </section>

    <section class="panel reveal delay-2">
      <h2>Where the output goes</h2>
      <p>
        The run log. In a packaged build there is no developer console, so the
        <strong>Log</strong> tab is the only place to read what a script printed. Running
        from source, the same lines also appear in the terminal as
        <code>[renderer] …</code>.
      </p>
    </section>
`
  },

  {
    path: 'reference/formats.html',
    section: 'Reference',
    title: 'File formats',
    blurb: 'The .cuerunner workspace file, the .cuerunnerx bundle, how media is referenced, and the wireless telemetry document Cuerunner reads.',
    body: `
    <section class="panel reveal">
      <h1>File formats</h1>
    </section>

    <section class="panel reveal delay-1" id="workspace">
      <h2>The workspace file</h2>
      <p>
        A show is one <code>.cuerunner</code> file: JSON, holding the cues in order, the show's
        setup — the desk, the cast, the scenes, the mic plot, the triggers — and the
        window's own state such as which cue was selected.
      </p>
      <p>
        <strong>It does not hold the audio.</strong> Each audio cue stores the path to its
        file. Moving a show to another machine means taking the sound with it and keeping
        the paths valid: the simplest arrangement is a folder with the <code>.cuerunner</code>
        file and the audio beside it, copied whole.
      </p>
      <p>
        A cue whose file has gone says <em>missing</em> where its length should be, and a
        bar across the top of the window offers to relink it — point it at the file once
        and the rest of the cues in the same folder follow.
      </p>
      <p>
        If a file's cue grouping is damaged, it is repaired as the show opens rather than
        loaded as-is: a group's children are gathered into one block behind it, a cue whose
        group is not in the file keeps its place at the top level and fires with the show,
        and a loop of groups is broken so every cue in it returns to the top. A bar across
        the top of the window says how many repairs were made, and the list behind it names
        each one. The file on disk is unchanged until you save, which writes the repaired
        grouping.
      </p>
      <div class="note">
        Show files are not converted. The shape is declared and checked down to the fields, and
        a file this build does not know is refused — naming the file and the fact, with nothing
        on disk touched — rather than filled in. A settings section this build writes and the
        file leaves out is a refusal, and so is a field inside a section that this build does
        not write or that the file has not got. What a field carries is checked as well, but
        only for its JSON kind: a string where this build writes a number — or a number where it
        writes a list of strings, or an entry of such a list that is not what the list carries —
        is refused the same way, and <code>null</code> is read only where the show's own types
        allow it. A cue's own fields are read the same way, and the sentence names the cue: a
        MIDI cue's messages are a list, every message an object, a crosspoint's gain a number,
        and an OSC argument's value a number, a string or a boolean — a cue field carrying any
        other kind refuses, as does <code>null</code> where a cue's types allow none. What a cue
        carries that this build does not declare is kept rather than refused, because a cue on
        disk holds fields the runtime cue type does not: <code>media</code>, the route its file
        was found by. What a value <em>says</em> is the app's reading rather than the file's, so a
        name the code does not offer, a desk kind among them, is read as it stands. The one that
        catches a show saved before the scenes changed is inside the settings: the strips, the
        faders and the scenes are checked field by field, so a show whose channels carried a
        fader of their own, or whose scenes listed who was open rather than what rides what, is
        refused by name. Setting it up again takes minutes and no hand-editing: the channels and
        faders in <strong>Show Settings → Channels</strong>, and the placements in the
        <strong>Scenes</strong> grid, which is where they live now. A file refused over a value
        is the other case, and not one to set up again: the sentence names the field and both
        kinds, and since nothing here guesses what the value was meant to be, the file is
        corrected where that value sits or opened in the build that wrote it. Saving does not
        convert one either: the show on screen is written as it stands, and a save over a file
        this build cannot read keeps the history it had and replaces the file all the same.
      </div>
    </section>

    <section class="panel reveal delay-1" id="bundle">
      <h2>The bundle file<span class="pro">Pro</span></h2>
      <p>
        A <code>.cuerunnerx</code> is the show <em>and</em> its audio as one file: a zip holding
        <code>show.cuerunner</code> and a <code>media/</code> folder, with the showfile pointing
        inside it. It opens in any file manager, and its bytes are a function of the show,
        so two exports of the same show are the same file.
      </p>
      <p>
        It carries up to about 4 GB of media — the zip format's own limit without its
        64-bit extension, which Cuerunner does not write. A larger show is refused rather
        than written as an archive that misreports its own contents.
      </p>
      <p>
        The file also carries a checksum of everything in it, and an import whose contents
        do not match is refused rather than half-unpacked. See
        <a href="../guides/showfile.html#bundle">Versions and handover</a>.
      </p>
    </section>

    <section class="panel reveal delay-1" id="telemetry">
      <h2>Wireless telemetry</h2>
      <p>
        Apart from Sennheiser EW-DX receivers, which Cuerunner reads directly, it does not
        speak any receiver's own protocol. A source — an HTTP address or a file on disk —
        returns this document:
      </p>
      <div class="code"><code>{
  "channels": [
    { "id": "ulxd-1", "name": "Pack 1", "batteryPercent": 42,
      "batteryMinutes": 95, "rfDbm": -62, "audioLevel": 71,
      "muted": false, "frequencyMhz": 606.5 }
  ]
}</code></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Field</th><th>Meaning</th></tr></thead>
          <tbody>
            <tr><td><code>id</code></td><td>Stable identifier for the channel. Required.</td></tr>
            <tr><td><code>name</code></td><td>What the receiver calls it.</td></tr>
            <tr><td><code>batteryPercent</code></td><td>0–100.</td></tr>
            <tr><td><code>batteryMinutes</code></td><td>Runtime left, if the receiver reports it.</td></tr>
            <tr><td><code>rfDbm</code></td><td>Signal strength, negative dBm.</td></tr>
            <tr><td><code>rfWeak</code></td><td>Whether the receiver itself calls the signal weak. When it is present it replaces the <strong>Signal below</strong> line for that channel, and it goes with <code>rfDbm</code>.</td></tr>
            <tr><td><code>audioLevel</code></td><td>0–100.</td></tr>
            <tr><td><code>muted</code></td><td>Whether the channel is muted.</td></tr>
            <tr><td><code>warnings</code></td><td>What the receiver itself says is wrong, as a list of <code>{ "text": "audio clipping", "critical": false }</code>. Each is announced once when it appears and shown under the pack; <code>critical</code> marks one that makes the pack unusable until it is dealt with.</td></tr>
            <tr><td><code>frequencyMhz</code></td><td>The frequency it is on.</td></tr>
          </tbody>
        </table>
      </div>
      <p>
        The field names are the contract: a bridge written against a receiver's own API
        only has to emit them. Any field a channel does not report is left out, and the
        panel shows nothing for a reading that was never made rather than a zero.
      </p>
    </section>
`
  },

  {
    path: 'reference/troubleshooting.html',
    section: 'Reference',
    title: 'Troubleshooting',
    blurb: 'Symptoms, causes and fixes for Cuerunner, and the known limitations.',
    body: `
    <section class="panel reveal">
      <h1>Troubleshooting</h1>
      <p class="doc-lede">
        Start with the <strong>Log</strong> tab in the dock and the <strong>Last run</strong>
        block in the cue's own inspector. Between them they usually say it outright. A cue
        whose last run failed is marked <em>failed</em> on its row — hover the mark for the
        reason — and the Log tab counts the errors written since you last had it open.
      </p>
    </section>

    <section class="panel reveal delay-1">
      <h2>Cues</h2>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Symptom</th><th>Cause and fix</th></tr></thead>
          <tbody>
            <tr>
              <td>GO skips a cue</td>
              <td>It is disarmed — the row says so. Arm it from the right-click menu or the Basics tab.</td>
            </tr>
            <tr>
              <td>An audio cue is silent after moving files</td>
              <td>Its file has moved. The row says <em>missing</em>; use the relink bar at the top of the window, and see <a href="./formats.html#workspace">the workspace file</a>.</td>
            </tr>
            <tr>
              <td>The cue list order differs from the file you saved</td>
              <td>The file's cue grouping was damaged — children scattered, a cue naming a group that is not in the file, or groups inside each other — and was repaired as the show opened. A bar at the top of the window says how many repairs were made. The file on disk is unchanged until you save, which writes the repaired grouping.</td>
            </tr>
            <tr>
              <td>Everything goes quiet at once and the rows say <em>audio device lost</em></td>
              <td>The sound device went away mid-show — unplugged, taken by another program in exclusive mode, or a driver that stopped calling. The engine released the cues it was playing and said so in the alarm strip, the transport bar's alarm chip and the log. Settings → Audio shows the device and the engine's own readout of it, and is where another interface is chosen. When the device is back, <strong>Reconnect device</strong> sends the show's settings again and the engine reopens it: the readout updates at once, and the failure text clears. The alarm the loss raised is not the engine's to take down — it stands in the alarm strip until it is dismissed there.</td>
            </tr>
            <tr>
              <td>A MIDI cue does nothing</td>
              <td>No port: the cue names none and the show has no default output, or the interface is gone. Settings → MIDI, and the Monitor reports an interface that disappeared.</td>
            </tr>
            <tr>
              <td>A Stop or Fade cue does nothing</td>
              <td>The cue it was aimed at has been deleted. Its tab shows <em>— not in this show —</em> where the target was, and a Stop cue fired like that is marked <em>failed</em>. Choose another target.</td>
            </tr>
            <tr>
              <td>A show control cue does nothing</td>
              <td>The show's desk does not take MIDI — the cue's panel says so — or the device ID does not match the console. 127 reaches everything.</td>
            </tr>
            <tr>
              <td>A network cue fails with "Failed to fetch"</td>
              <td>Nothing answered at that address: wrong host or port, or the target is not running. The Last run block has the exact error.</td>
            </tr>
            <tr>
              <td>A network cue succeeds but the show stalls</td>
              <td>The cue holds the show until the server answers. Lower its timeout, or put it in a group set to fire everything at once.</td>
            </tr>
            <tr>
              <td>A script cue never finishes</td>
              <td>Its timeout is 0, which waits for ever. Set one, or check what the script is waiting on in the log.</td>
            </tr>
            <tr>
              <td>A trigger does not fire the cue</td>
              <td>The input is off (Settings → Network or MIDI), the cue is disarmed, the address does not match exactly, or the repeat guard is swallowing a second message. The Monitor shows what actually arrived.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="panel reveal delay-1">
      <h2>The window</h2>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Symptom</th><th>Cause and fix</th></tr></thead>
          <tbody>
            <tr>
              <td>A banner says the interface stopped unexpectedly</td>
              <td>The window crashed and was recovered. The show itself kept playing — the engine is in another process. The banner carries the error; the log has the rest.</td>
            </tr>
            <tr>
              <td>The cue list looks empty after opening a show</td>
              <td>Every group is collapsed. <strong>Expand</strong> in the toolbar opens the top level.</td>
            </tr>
            <tr>
              <td>The wireless panel shows no readings</td>
              <td>No source, or the source is unreachable — Settings → Wireless reports which. <strong>Demo</strong> proves the panel works.</td>
            </tr>
            <tr>
              <td>Where are the error messages?</td>
              <td>The Log tab, and the Last run block on the cue. Alarms also appear in the transport bar, whatever panel is open.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="panel reveal delay-2" id="limitations">
      <h2>Known limitations</h2>
      <ul class="tight-list">
        <li>No video or image cues. Video is driven by talking to something that plays it, through a network, OSC or MIDI cue.</li>
        <li>No cue-level audio effects beyond level, pan, rate and fades.</li>
        <li>ASIO runs a single driver at a time and at most 32 channels: a rig that needs two interfaces on two ASIO drivers at once is not covered.</li>
        <li>OSC input is UDP only.</li>
        <li>The channel ceiling a desk model states is the number the console publishes rather than a measurement: a show with more channels than the selected model takes is named under the desk connection, with the number, and every channel is sent as it always was. Only the count control stops at it, and a show already larger than the ceiling keeps its own whole range on the dial rather than being trimmed back to it.</li>
        <li>An SQ's membership is written over the desk's own control service — TCP 51326 outbound, with a keepalive datagram to the desk's UDP 51324 — a protocol Allen &amp; Heath publish nothing about, spoken here from frames measured off an SQ-6 on firmware 1.6.1. The desk's own answer to a membership has never been read, so nothing here says a desk has accepted one: what a recall leaves out is worked out against what Cuerunner last sent, not against the desk. The channel mutes ride the MIDI service beside it, on 51325. The session leaves by the desk's own door when the show stops, and one the desk loses without that goodbye leaves it mute until it is reset — said in the log, on the device row and in an alarm, which is why a lost session is not dialled again in a loop.</li>
        <li>The tablet view is read-only by design.</li>
        <li>Cuerunner is distributed outside the app stores, and the release notes say whether a build is signed: Windows warns when an unsigned installer is run, and macOS warns about an unidentified developer at first launch — Gatekeeper refuses such an app on a machine that has not seen it. Each release publishes its digests twice: a <code>SHA256SUMS</code> beside the assets on its release page, naming the files that page carries, and <code>latest/SHA256SUMS</code> on the download host, naming the files the cards link.</li>
        <li>The Linux AppImage is experimental: MIDI needs ALSA development headers present when dependencies are installed.</li>
      </ul>
    </section>
`
  }
]
