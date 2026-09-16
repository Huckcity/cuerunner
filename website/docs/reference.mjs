// The reference: pages you look something up in.
//
// Tables, field by field, with defaults. No walkthroughs — a page here answers "what does
// this field do" and "what exactly does it send", and links back to the guide that shows
// it being used.
export const REFERENCE = [
  {
    path: 'reference/index.html',
    title: 'Reference',
    blurb: 'Every cue type and field, every setting, the keyboard table, the OSC and MIDI messages WinsLab answers to, the script helpers and the file formats.',
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
          <p>What WinsLab listens for, what a trigger matches, and what a cue sends.</p>
        </a>
        <a class="card doc-card" href="./script-api.html">
          <h3>Script cue API</h3>
          <p><code>shell()</code>, <code>include()</code>, timeouts and what a script may touch.</p>
        </a>
        <a class="card doc-card" href="./formats.html">
          <h3>File formats</h3>
          <p>The <code>.wlab</code> workspace, media paths, and the wireless telemetry document.</p>
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
    blurb: 'Every WinsLab cue type and every field it carries, with defaults.',
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
            <tr><td>Triggers<span class="pro">Pro</span></td><td>none</td><td>OSC, MIDI or show-control messages that fire this cue. See <a href="./control.html">control</a>.</td></tr>
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
              <td><strong>Scene</strong><span class="pro">Pro</span></td>
              <td><strong>Scene</strong> — the one to recall. A recall sends only the DCA changes between where the desk stands and where the scene says it should be. With no scene chosen the cue does nothing.</td>
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
    blurb: 'Every setting in WinsLab, what it does, and whether it is saved with the show or with the computer.',
    body: `
    <section class="panel reveal">
      <h1>Settings</h1>
      <p class="doc-lede">
        <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>,</kbd>, or WinsLab ▾ → Settings. The sidebar
        splits them by where they are kept: <strong>this show</strong> travels in the
        <code>.wlab</code> file, <strong>this computer</strong> stays on the machine.
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
        setting.
      </p>
    </section>

    <section class="panel reveal delay-2" id="midi">
      <h2>MIDI</h2>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Setting</th><th>Default</th><th>What it does</th></tr></thead>
          <tbody>
            <tr><td>Send on</td><td>none</td><td>The port MIDI cues use unless they name their own.</td></tr>
            <tr><td>Listen to MIDI<span class="pro">Pro</span></td><td>off</td><td>Opens the input ports you tick — all of them if you tick none — so cues can fire from notes and controllers.</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="panel reveal delay-2" id="network">
      <h2>Network<span class="pro">Pro</span></h2>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Setting</th><th>Default</th><th>What it does</th></tr></thead>
          <tbody>
            <tr><td>OSC control</td><td>on, port 53000</td><td>Takes cues and commands from consoles, desks and tablets. A port another program holds is reported rather than taken.</td></tr>
            <tr><td>Find devices</td><td>off</td><td>Lists gear that announces itself on the network — Dante endpoints among them — in the Monitor, and warns when one drops off.</td></tr>
            <tr><td>↳ Service types</td><td><code>_netaudio-arc._udp.local</code>, <code>_netaudio-cmc._udp.local</code></td><td>Under Advanced. What to browse for.</td></tr>
            <tr><td>↳ Gone after</td><td>30 s</td><td>Under Advanced. How long a device can go unseen before it counts as gone.</td></tr>
            <tr><td>Tablet view</td><td>off, port 53100</td><td>Serves a read-only view of the show on the local network. An access code is required; anyone without it is refused.</td></tr>
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
            <tr><td>Sources</td><td>none</td><td>Where readings come from: an HTTP address, a file on disk, or the demo rack. <a href="./formats.html#telemetry">The document format</a>.</td></tr>
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

    <section class="panel reveal delay-3" id="show">
      <h2>Show Settings</h2>
      <p>
        WinsLab ▾ → Show Settings. These are the show's own, and travel in the file.
      </p>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Tab</th><th>What is on it</th></tr></thead>
          <tbody>
            <tr><td>Channels</td><td>The desk connection — OSC, MIDI or MIDI over TCP, with its address — the channel strips, and the DCA each rides. The line under the connection reads back exactly what will be sent.</td></tr>
            <tr><td>Cast</td><td>Performers, their parts, the channel each is on, and ensembles for opening a section at once.</td></tr>
            <tr><td>Mic plot</td><td>Packs, the channel each is patched to, and who is wearing it. Changing a performer on a pack records a swap.</td></tr>
          </tbody>
        </table>
      </div>
    </section>
`
  },

  {
    path: 'reference/keyboard.html',
    section: 'Reference',
    title: 'Keyboard',
    blurb: 'Every WinsLab keyboard shortcut and where it works.',
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
            <tr><td><kbd>Esc</kbd></td><td>STOP — stop everything</td><td>Anywhere except a text field</td></tr>
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
            <tr><td><kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>Shift</kbd> + <kbd>S</kbd></td><td>Save As</td></tr>
            <tr><td><kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>,</kbd></td><td>Settings</td></tr>
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
            <tr><td><kbd>Esc</kbd></td><td>Close a context menu, or cancel a rename — a bare press is the transport's</td><td>Cue list</td></tr>
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
    blurb: 'What WinsLab listens for, what a cue trigger matches, and what WinsLab sends to a desk.',
    body: `
    <section class="panel reveal">
      <h1>OSC &amp; MIDI control<span class="pro">Pro</span></h1>
      <p class="doc-lede">
        For setting it up, see <a href="../guides/console.html">firing cues from a
        console</a>. This is the message-level detail.
      </p>
    </section>

    <section class="panel reveal delay-1" id="listening">
      <h2>What WinsLab listens on</h2>
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
            <tr><td><code>/winslab/panic</code> (any arguments)</td><td>Panic: everything stops with a 200 ms fade.</td></tr>
            <tr><td>MIDI All Sound Off — controller 120, value 0, any channel, any listened port</td><td>The same.</td></tr>
          </tbody>
        </table>
      </div>
      <p>
        Both are acted on where the engine is rather than in the window, so the fade starts
        whether or not the interface is answering. The run log records the sender:
        <code>[main] panic (osc): /winslab/panic from 192.168.1.24:8000</code>.
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
      <h2>What WinsLab sends</h2>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Cue</th><th>What goes out</th></tr></thead>
          <tbody>
            <tr><td>OSC cue</td><td>The address and its typed arguments, to the host and port on the cue.</td></tr>
            <tr><td>MIDI cue</td><td>Its list of messages, on the cue's port or the show's default output.</td></tr>
            <tr><td>Show Control cue</td><td>An MSC message: command, equipment format, device ID (127 reaches everything), and cue and list where the command carries them.</td></tr>
            <tr><td>Scene cue<span class="pro">Pro</span></td><td>Only the DCA changes between where the desk stands and the scene: opens and closes, and nothing for a mic that is already right.</td></tr>
          </tbody>
        </table>
      </div>
      <p>
        The desk a scene cue drives is set up once in Show Settings → Channels, where the
        read-back line names the exact addresses or notes it will send.
      </p>
    </section>
`
  },

  {
    path: 'reference/script-api.html',
    section: 'Reference',
    title: 'Script cue API',
    blurb: 'What a WinsLab script cue can call: shell, include, timeouts, logging and the limits.',
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
        open <code>.wlab</code> files you trust, and only on a network you trust — the
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
    blurb: 'The .wlab workspace file, the .wlabx bundle, how media is referenced, and the wireless telemetry document WinsLab reads.',
    body: `
    <section class="panel reveal">
      <h1>File formats</h1>
    </section>

    <section class="panel reveal delay-1" id="workspace">
      <h2>The workspace file</h2>
      <p>
        A show is one <code>.wlab</code> file: JSON, holding the cues in order, the show's
        setup — the desk, the cast, the scenes, the mic plot, the triggers — and the
        window's own state such as which cue was selected.
      </p>
      <p>
        <strong>It does not hold the audio.</strong> Each audio cue stores the path to its
        file. Moving a show to another machine means taking the sound with it and keeping
        the paths valid: the simplest arrangement is a folder with the <code>.wlab</code>
        file and the audio beside it, copied whole.
      </p>
      <p>
        A cue whose file has gone says <em>missing</em> where its length should be, and a
        bar across the top of the window offers to relink it — point it at the file once
        and the rest of the cues in the same folder follow.
      </p>
      <div class="note">
        Older show files are migrated as they open: the settings that were once
        <code>autoContinue</code> and <code>autoFollow</code> become
        <strong>Advance</strong>, and groups that listed their children become children
        that name their parent. Saving writes the current shape.
      </div>
    </section>

    <section class="panel reveal delay-1" id="bundle">
      <h2>The bundle file<span class="pro">Pro</span></h2>
      <p>
        A <code>.wlabx</code> is the show <em>and</em> its audio as one file: a zip holding
        <code>show.wlab</code> and a <code>media/</code> folder, with the showfile pointing
        inside it. It opens in any file manager, and its bytes are a function of the show,
        so two exports of the same show are the same file.
      </p>
      <p>
        It carries up to about 4 GB of media — the zip format's own limit without its
        64-bit extension, which WinsLab does not write. A larger show is refused rather
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
        WinsLab does not speak any receiver's own protocol. A source — an HTTP address or a
        file on disk — returns this document:
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
            <tr><td><code>audioLevel</code></td><td>0–100.</td></tr>
            <tr><td><code>muted</code></td><td>Whether the channel is muted.</td></tr>
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
    blurb: 'Symptoms, causes and fixes for WinsLab, and the known limitations.',
    body: `
    <section class="panel reveal">
      <h1>Troubleshooting</h1>
      <p class="doc-lede">
        Start with the <strong>Log</strong> tab in the dock and the <strong>Last run</strong>
        block in the cue's own inspector. Between them they usually say it outright.
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
              <td>A MIDI cue does nothing</td>
              <td>No port: the cue names none and the show has no default output, or the interface is gone. Settings → MIDI, and the Monitor reports an interface that disappeared.</td>
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
        <li>The tablet view is read-only by design.</li>
        <li>WinsLab is not code-signed for the app stores, so the first launch warns about an unidentified developer.</li>
        <li>The Linux AppImage is experimental: MIDI needs ALSA development headers present when dependencies are installed.</li>
      </ul>
    </section>
`
  }
]
