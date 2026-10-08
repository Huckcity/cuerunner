// The guides: pages you read start to finish, once, to learn how to do a thing.
//
// A guide names a job, walks it through in order, and links to the reference for the
// fields it passed on the way. Anything that is looked up rather than read — every field
// of every cue type, the shortcut table, the telemetry format — belongs in reference.mjs.
export const GUIDES = [
  {
    path: 'guide.html',
    title: 'Guides',
    blurb: 'Walkthroughs for running a show with Cuerunner: your first show, building a cue list, running it, and the Pro features around it.',
    body: `
    <section class="panel reveal">
      <h1>Guides</h1>
      <p class="doc-lede">
        Short walkthroughs, in the order most people need them. Each one is a job:
        read it once, do the thing, and come back to the
        <a href="./reference/index.html">reference</a> when you need the detail.
      </p>
    </section>

    <section class="panel reveal delay-1">
      <h2>Start here</h2>
      <div class="cards two-col doc-cards">
        <a class="card doc-card" href="./guides/first-show.html">
          <h3>Your first show</h3>
          <p>Install it, open the demo, put your own sound in a cue, and save the file.</p>
          <span class="doc-card-meta">10 minutes</span>
        </a>
        <a class="card doc-card" href="./guides/cue-list.html">
          <h3>Building a cue list</h3>
          <p>Numbering, notes, groups, waits and fades, and the timing that makes a
             sequence run itself.</p>
          <span class="doc-card-meta">Everything free</span>
        </a>
        <a class="card doc-card" href="./guides/sound.html">
          <h3>Working with sound</h3>
          <p>Levels, fades, trims, loops and vamps, and where the channels land on
             the device.</p>
          <span class="doc-card-meta">Audio cues</span>
        </a>
        <a class="card doc-card" href="./guides/running.html">
          <h3>Running the show</h3>
          <p>GO, stop, what the bar at the top is telling you, and what to check before
             the house opens.</p>
          <span class="doc-card-meta">Show night</span>
        </a>
      </div>
    </section>

    <section class="panel reveal delay-2">
      <h2>Around the cue stack</h2>
      <p class="doc-lede">
        The cue stack is the free app and always will be — and so is being driven by one:
        OSC and MIDI in, and the monitor that shows what arrived. These are the parts that
        run the rest of the rig; the desk, the radios, the tablet and the second machine
        are part of what a key turns on.
      </p>
      <div class="cards two-col doc-cards">
        <a class="card doc-card" href="./guides/console.html">
          <h3>Firing cues from a console</h3>
          <p>Let a lighting desk, a sound desk or a footswitch press GO, and see what
             arrives.</p>
        </a>
        <a class="card doc-card" href="./interop.html">
          <h3>Working with other programs</h3>
          <p>Video through an OSC cue, lights through the desk or MSC, and the buttons that
             fire a cue.</p>
        </a>
        <a class="card doc-card" href="./guides/desk.html">
          <h3>Scenes and the desk</h3>
          <p>Which channels ride which fader, scene by scene, and how a recall writes it.</p>
        </a>
        <a class="card doc-card" href="./guides/wireless.html">
          <h3>Watching the radio mics</h3>
          <p>The plot, the batteries, the alarm before one dies mid-line, and the report
             afterwards.</p>
        </a>
        <a class="card doc-card" href="./guides/script.html">
          <h3>Following the script</h3>
          <p>The script beside the cue list, cues pinned to their lines, and the same view
             on a tablet.</p>
        </a>
        <a class="card doc-card" href="./redundancy.html">
          <h3>A backup machine</h3>
          <p>A second computer on the same show, ready to pick it up mid-cue.</p>
        </a>
        <a class="card doc-card" href="./guides/showfile.html">
          <h3>Versions and handover</h3>
          <p>What each save changed, comparing two versions, merging two people's work,
             and the show as one file.</p>
        </a>
      </div>
    </section>

    <section class="panel reveal delay-3">
      <h2>Looking something up?</h2>
      <p>
        The <a href="./reference/index.html">reference</a> has every cue type and field,
        every setting, the keyboard table, the OSC and MIDI messages Cuerunner answers to,
        the script helpers, the file formats, and what to do when something is wrong.
      </p>
    </section>
`
  },

  {
    path: 'guides/first-show.html',
    section: 'Guides',
    title: 'Your first show',
    blurb: 'Install Cuerunner, open the demo show, build a cue list of your own, and save it.',
    body: `
    <section class="panel reveal">
      <h1>Your first show</h1>
      <p class="doc-lede">
        Ten minutes, start to finish: install it, look at a show that already works, then
        build a small one of your own and save it.
      </p>
    </section>

    <section class="panel reveal delay-1">
      <h2>1. Install</h2>
      <div class="cards two-col">
        <article class="card download-card">
          <h3>Windows</h3>
          <a class="action action-ghost" href="https://pub.cuerunner.app/latest/Cuerunner-Setup.exe">Download .exe</a>
        </article>
        <article class="card download-card">
          <h3>macOS</h3>
          <a class="action action-ghost" href="https://pub.cuerunner.app/latest/Cuerunner.dmg">Download .dmg</a>
        </article>
      </div>
      <p>
        Cuerunner is distributed outside the app stores: the
        <a href="https://github.com/Huckcity/cuerunner/releases/latest">release notes</a> name
        whether a build is signed. Windows warns when an unsigned installer is run, and macOS
        warns about an unidentified developer at first launch. Downloads come from
        <code>pub.cuerunner.app</code>, and these links are the newest release's files. A Linux
        AppImage is published too, and is experimental.
      </p>
      <p>
        <a href="https://pub.cuerunner.app/latest/SHA256SUMS">SHA256SUMS</a> carries the
        SHA-256 digest of each file the release serves, so a download can be checked against
        the release that describes it.
      </p>
    </section>

    <section class="panel reveal delay-1">
      <h2>2. Open the demo</h2>
      <p>
        <strong>Cuerunner ▾ → Open Demo Workspace</strong>. It is a real show: audio, a
        group with a count-in, MIDI and OSC cues, a network cue, a script cue and a fade,
        with its own sound files — and, on the console's own faders, two scenes already
        built: Act One and Wedding, four strips each, so the Scenes view has a show in it
        the moment it is opened. Nothing you do to it touches a file of yours — it opens
        unsaved, so Save As… makes it yours if you want to keep it.
      </p>
      <figure class="figure">
        <a href="../assets/guide/01-window.png" target="_blank" rel="noreferrer">
          <img src="../assets/guide/01-window.png" alt="The Cuerunner window with the demo show loaded: the cue list on the left, the inspector on the right, the waveform below and the transport at the bottom." />
        </a>
        <figcaption>The demo show, ready to run.</figcaption>
      </figure>
      <p>Press <kbd>Space</kbd>. The first cue plays, and the bar at the top moves on to the next one.</p>
      <ol class="steps">
        <li><strong>The bar under the toolbar</strong> answers the two questions asked mid-show: what is playing, and what GO will fire next. Each side shows the cue's number, its name and the first line of its notes.</li>
        <li><strong>The cue list</strong> is the running order. One row per cue.</li>
        <li><strong>The inspector</strong> on the right is the selected cue's settings. Its tabs change with the type of cue.</li>
        <li><strong>The dock</strong> along the bottom shows one panel at a time: the selected cue, the run log, and the Pro panels.</li>
        <li><strong>STOP and GO</strong> are the transport. Panic is <kbd>Shift</kbd> + <kbd>Esc</kbd>, and in the Playback menu.</li>
      </ol>
    </section>

    <section class="panel reveal delay-2">
      <h2>3. Make one of your own</h2>
      <ol class="steps">
        <li><strong>Cuerunner ▾ → New</strong>, then double-click the name in the toolbar and call it something. The dock along the bottom opens folded away — a show with no cues in it has nothing for that panel to show, so the list has the room until something is in it. Any tab along the bottom opens it, and it stays where you leave it.</li>
        <li><strong>Drag your audio files onto the cue list.</strong> One cue per file, named after the file, in the order you dropped them. Or press <strong>Audio</strong> in the toolbar and pick a file with Browse: the cue takes the file's name unless you have already named it, and until it has a file its row reads <em>no file</em>.</li>
        <li><strong>Select a cue</strong> and look at the inspector. On <strong>Basics</strong>, give it a number you will recognise in a running order and write a note to yourself — the note shows up in the bar at the top when the cue is next, which is where you will actually read it.</li>
        <li><strong>Press GO</strong> to hear it. <strong>STOP</strong> stops everything.</li>
        <li><strong>Save</strong> with <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>S</kbd>. Cuerunner writes a <code>.cuerunner</code> file, which holds the cues and the show's setup but not the audio itself. A show you have not named yet takes the file's name; one you have keeps its own, whatever the file is called.</li>
      </ol>
      <div class="note">
        The show file points at your audio where it sits on disk. Moving a show to another
        machine means taking the sound with it — see
        <a href="../reference/formats.html">the workspace file</a> for how to keep the
        links intact.
      </div>
    </section>

    <section class="panel reveal delay-3">
      <h2>Next</h2>
      <p>
        <a href="./cue-list.html">Building a cue list</a> covers groups, waits, fades and
        the timing that makes a run of cues fire itself.
        <a href="./running.html">Running the show</a> is what to do on the night.
      </p>
    </section>
`
  },

  {
    path: 'guides/cue-list.html',
    section: 'Guides',
    title: 'Building a cue list',
    blurb: 'Numbering and notes, the cue types, groups, and the timing that makes a sequence run itself.',
    body: `
    <section class="panel reveal">
      <h1>Building a cue list</h1>
      <p class="doc-lede">
        A show is a list of cues in the order they happen. This is how to get one from a
        script to something you can run with one finger.
      </p>
    </section>

    <section class="panel reveal delay-1">
      <h2>Adding and ordering</h2>
      <p>
        The toolbar adds cues: <strong>Audio</strong>, <strong>Group</strong>,
        <strong>Fade</strong>, <strong>Wait</strong>, <strong>Stop</strong>, and the rest
        under <strong>More</strong>. A new cue lands after the selected one. Dragging a
        row moves it; dropping audio files on the list adds them where you dropped them.
      </p>
      <figure class="figure">
        <a href="../assets/guide/02-cue-list.png" target="_blank" rel="noreferrer">
          <img src="../assets/guide/02-cue-list.png" alt="The cue list: numbered rows with type icons, names, durations, pre-wait, post-wait and advance columns." />
        </a>
        <figcaption>One row per cue. The chevron on a group row opens it.</figcaption>
      </figure>
      <p>
        Right-click a row for duplicate, delete, colour, arm and disarm. A
        <strong>disarmed</strong> cue stays in the list and is skipped by GO, which is how
        you take something out of a show without losing it. Undo is
        <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>Z</kbd> and covers the last 50 edits.
      </p>
    </section>

    <section class="panel reveal delay-1">
      <h2>Numbers and names</h2>
      <p>
        Numbers are yours: they are text, not positions, so <code>12.5</code> and
        <code>LX 12</code> are both fine and inserting a cue renumbers nothing. Names are
        what you read at speed — name them for the moment in the show, not the file.
        Double-click a row to rename it.
      </p>
      <p>
        Every cue has <strong>notes</strong>. The first line appears in the bar at the top
        when the cue is playing or next, so a note is worth writing: "let it run under the
        scene change", "wait for the door".
      </p>
    </section>

    <section class="panel reveal delay-2">
      <h2>The cue types</h2>
      <p>
        Twelve of them, and the <a href="../reference/cue-types.html">reference</a> lists
        every field of each. In practice:
      </p>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Type</th><th>What it is for</th></tr></thead>
          <tbody>
            <tr><td>Audio</td><td>Play a file. Level, pan, fades, loops, trims and routing.</td></tr>
            <tr><td>Wait</td><td>Hold for a set time. The glue in a sequence.</td></tr>
            <tr><td>Fade</td><td>Ramp another cue's level, and optionally stop it at the end.</td></tr>
            <tr><td>Stop</td><td>Stop one cue, or everything, with or without a fade.</td></tr>
            <tr><td>Group</td><td>Cues inside a cue: fire them in order, all at once, at random, or on a timeline.</td></tr>
            <tr><td>MIDI / OSC / Network</td><td>Send a message to something else in the rig.</td></tr>
            <tr><td>Show Control</td><td>MSC: GO, STOP and LOAD to a desk that speaks it.</td></tr>
            <tr><td>Script</td><td>Run JavaScript, including a system command.</td></tr>
            <tr><td>Scene<span class="pro">Pro</span></td><td>Move the sound desk to a scene you built.</td></tr>
            <tr><td>Devamp</td><td>Let a looping cue out of its loop and play on.</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="panel reveal delay-2">
      <h2>Groups</h2>
      <p>
        A group is a cue with cues inside it. GO fires the group, and what happens next is
        the group's <strong>mode</strong>:
      </p>
      <ul class="tight-list">
        <li><strong>Sequence</strong> — its children in order, each after the one before.</li>
        <li><strong>All at once</strong> — everything together: a bang, a blackout, three sends in one press.</li>
        <li><strong>Random</strong> — one child, picked at random. Good for a stinger you do not want to be identical every night.</li>
        <li><strong>Timeline</strong> — each child at an offset you set by dragging it. The dock draws the timeline for a group in this mode.</li>
        <li><strong>Playlist</strong> — one child per GO. The group holds the show until a full pass is done, so a walk-in playlist of thirty cues is thirty presses.</li>
      </ul>
      <figure class="figure">
        <a href="../assets/guide/07-timeline.png" target="_blank" rel="noreferrer">
          <img src="../assets/guide/07-timeline.png" alt="The timeline editor: a group's children laid out along a time axis with draggable offsets." />
        </a>
        <figcaption>A timeline group: drag a cue to change when it fires.</figcaption>
      </figure>
      <p>
        Stopping a cue inside a group is not the same as stopping the group: the group moves
        on from it. A sequence steps to the next child, a timeline stops waiting for the
        one you took away, and a playlist's pass is left where it was, so the next GO fires
        the child after it.
      </p>
      <p>
        Open a group with the chevron on its row. A group's duration is worked out from
        what is inside it.
      </p>
    </section>

    <section class="panel reveal delay-3">
      <h2>Timing: pre-wait, post-wait and advance</h2>
      <p>Three settings on the Basics tab decide how a cue behaves in time.</p>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Setting</th><th>What it does</th></tr></thead>
          <tbody>
            <tr><td><strong>Pre-wait</strong></td><td>Waits this long after GO before the cue does anything.</td></tr>
            <tr><td><strong>Post-wait</strong></td><td>Waits this long after the cue finishes before handing over.</td></tr>
            <tr><td><strong>Advance</strong></td><td>Whether the next cue fires by itself: <strong>None</strong>, <strong>On start</strong> (as soon as this one starts) or <strong>On end</strong> (when it finishes).</td></tr>
          </tbody>
        </table>
      </div>
      <p>
        <strong>On start</strong> chains cues that should happen together but stay separate
        rows. <strong>On end</strong> is the one to reach for after a wait: a count-in that
        hands over to the music by itself is a wait with Advance set to On end.
      </p>
      <div class="note">
        An audio cue does not hold the show. It starts, and GO moves on. That is why a
        sequence uses waits to time what comes next rather than waiting for the sound to
        finish — unless you set Advance to On end, which does wait for it.
      </div>
    </section>

    <section class="panel reveal delay-3">
      <h2>Next</h2>
      <p>
        <a href="./sound.html">Working with sound</a> goes into audio cues properly.
        <a href="./running.html">Running the show</a> is the night itself.
      </p>
    </section>
`
  },

  {
    path: 'guides/sound.html',
    section: 'Guides',
    title: 'Working with sound',
    blurb: 'Audio cues in practice: levels and pan, fades, trimming silence, loops and vamps, and routing channels to the device.',
    body: `
    <section class="panel reveal">
      <h1>Working with sound</h1>
      <p class="doc-lede">
        Everything an audio cue can do, in the order you usually need it.
      </p>
    </section>

    <section class="panel reveal delay-1">
      <h2>The file, and what plays of it</h2>
      <figure class="figure shot-narrow">
        <a href="../assets/guide/03-inspector-audio.png" target="_blank" rel="noreferrer">
          <img src="../assets/guide/03-inspector-audio.png" alt="The Audio tab of the inspector: file, playback rate, trim, volume, pan and output routing." />
        </a>
        <figcaption>The Audio tab.</figcaption>
      </figure>
      <p>
        <strong>Browse</strong> picks the file; the folder it sits in is written under the
        name. WAV, AIFF, FLAC, MP3, M4A and OGG all play. A file at a different sample rate
        to the device is resampled as it plays — pitch and tempo are unchanged.
      </p>
      <p>
        <strong>Start time</strong> and <strong>End time</strong>, on the Time &amp; Loops
        tab, are the part of the file this cue plays. Leave the end empty to play to the
        end of the file. The waveform in the dock shows both, and you can drag them there.
      </p>
      <p>
        <strong>Trim silence</strong> moves the start and end to the first and last sound
        in the file, so a cue fires on the sound rather than on whatever the editor left in
        front of it. It can be the default for new cues in Settings → Audio.
      </p>
    </section>

    <section class="panel reveal delay-1">
      <h2>Level, pan and fades</h2>
      <p>
        <strong>Volume</strong> and <strong>Pan</strong> are the cue's own, applied as it
        plays. <strong>Fade in</strong> ramps it up from silence over that many seconds
        when it starts, and <strong>Fade out</strong> takes it down to silence over that
        many seconds before its own end — the end of its region, or of its last loop — so a
        track that should not stop dead does not.
      </p>
      <p>
        To change a level while a cue is already playing, use a <strong>fade cue</strong>
        pointed at it: a target, a level to reach, and a time to take getting there. Tick
        <strong>Stop when done</strong> and the fade becomes a fade-out — the usual way to
        take music out under dialogue.
      </p>
      <p>
        A <strong>stop cue</strong> stops a target at once, or fades it out first over a
        time you set. <strong>Wait for fade</strong> holds the show until that fade has
        finished, which matters when the next cue starts the moment this one is done.
      </p>
    </section>

    <section class="panel reveal delay-2">
      <h2>Loops and vamps</h2>
      <p>
        <strong>Loop count</strong> on the Time &amp; Loops tab repeats the section between
        the start and end times. <code>0</code> plays it once; a number plays it that many
        extra times; <code>-1</code> loops for ever, which is a <strong>vamp</strong>.
      </p>
      <p>
        A vamp holds until you let it go. <strong>Make this a vamp</strong> sets it up, and
        a <strong>devamp cue</strong> aimed at that cue releases it: the loop finishes the
        lap it is on and plays out to the end of the file. That is the underscore that
        holds for a scene change of unknown length and then resolves properly.
      </p>
    </section>

    <section class="panel reveal delay-2">
      <h2>Where the channels go</h2>
      <p>
        <strong>Output routing</strong> on the Audio tab has three modes:
      </p>
      <ul class="tight-list">
        <li><strong>Automatic</strong> — the file's channels play in order on the device. Stereo file, stereo out.</li>
        <li><strong>Matrix</strong> — you say which file channel feeds which device channel, and at what gain. One channel can feed several outputs, and several can meet on one. This is how a mono effect reaches four zones, or a stereo file lands on outputs 7 and 8.</li>
        <li><strong>Silent</strong> — the cue runs and takes its time, and sends nothing. Useful as a placeholder that keeps a sequence's timing honest.</li>
      </ul>
      <p>
        The device itself, its sample rate, buffer and channel count are in
        Settings → Audio, with what the engine is actually doing underneath them.
      </p>
      <p>
        On Windows, <strong>Audio system</strong> above the device picks how the sound
        leaves the machine: <strong>Windows audio</strong>, the platform's own mixer, or
        <strong>ASIO</strong>, which drives an interface through its own driver instead.
        Everywhere else the row is the platform's own stack and nothing more. ASIO is the
        one for a rig whose interface has its own driver — a professional one, or a
        virtual one like Dante Virtual Soundcard — and for setting the buffer on the
        interface rather than letting Windows mix. While the show is open that driver is
        held by Cuerunner alone, and its own control panel owns the sample rate, the buffer
        and the channel count; Cuerunner reports what it was given, and the latency beside
        it is the driver's own, marked (driver). One driver at a time, and the whole
        interface's outputs, up to 32 channels. A machine with no ASIO driver says so
        when you choose it, and a driver that asks for a reset reopens the device — the
        show stops for that instant and the Audio tab says why.
      </p>
    </section>

    <section class="panel reveal delay-3">
      <h2>Next</h2>
      <p>
        <a href="./running.html">Running the show</a>, or the
        <a href="../reference/cue-types.html">field-by-field reference</a> for audio, fade,
        stop and devamp cues.
      </p>
    </section>
`
  },

  {
    path: 'guides/running.html',
    section: 'Guides',
    title: 'Running the show',
    blurb: 'GO, stop and panic, what the live and next bar is telling you, reading the run log, and a show-night checklist.',
    body: `
    <section class="panel reveal">
      <h1>Running the show</h1>
      <p class="doc-lede">
        Three keys and one bar. This is what they do and what to check before the house
        opens.
      </p>
    </section>

    <section class="panel reveal delay-1">
      <h2>The transport</h2>
      <div class="cards three-col">
        <article class="card state-go">
          <h3>GO</h3>
          <p><kbd>Space</kbd>, or the button. Fires the cue on the right of the bar, then moves on to the next armed one. A disarmed cue is skipped. After the last cue nothing is selected and GO fires nothing: the bar says so, and the show starts again when you select the cue to start it from.</p>
        </article>
        <article class="card state-stop">
          <h3>STOP</h3>
          <p><kbd>Esc</kbd>, or the button. Stops everything that is running: sound, waits, sequences, scripts. Opening another show, or starting a new one, stops the one that was playing the same way.</p>
        </article>
        <article class="card state-panic">
          <h3>PANIC</h3>
          <p><kbd>Shift</kbd> + <kbd>Esc</kbd>, or the Playback menu. Everything stops with a short fade instead of a hard cut, and anything stuck is released.</p>
        </article>
      </div>
      <p>
        Panic has no button on the transport on purpose: it is the one press you do not
        want a sleeve to find at the wrong moment. It is on the keyboard, in the menu, and
        it can be fired from the rig — see <a href="./console.html">firing cues from a
        console</a>.
      </p>
    </section>

    <section class="panel reveal delay-1">
      <h2>Live and next</h2>
      <p>
        The bar under the toolbar is the show at a glance. On the left is what is playing:
        its number, name, the note you wrote on it, elapsed time against what is left, and
        a progress line. On the right, larger, is what GO will fire next, with its own
        note. With several cues running it names the one that has been going longest and
        counts the rest.
      </p>
      <p>
        The cue list says the same thing in more detail: a playing row counts its Duration
        cell down, a cue in its pre-wait says so, and a vamping cue says it is vamping.
      </p>
    </section>

    <section class="panel reveal delay-2">
      <h2>When something is wrong</h2>
      <figure class="figure">
        <a href="../assets/guide/08-run-log.png" target="_blank" rel="noreferrer">
          <img src="../assets/guide/08-run-log.png" alt="The run log: timestamped lines with a level, showing a network cue that failed." />
        </a>
        <figcaption>The run log, with a failure in red.</figcaption>
      </figure>
      <p>
        The <strong>Log</strong> tab in the dock is the session's history: every cue fired,
        every message sent, and every failure with its reason. It holds the last 500 lines
        and is not saved with the show. A line that repeats is said once with a count.
      </p>
      <p>
        An audio event whose type the app does not recognise is named in the log with its
        count and does nothing else — it never reaches the show. An event of a known type
        carrying a field the app cannot look up still plays; the log names the field beside
        it. An engine built against a different set of events is a line you can see rather
        than a show that quietly does the wrong thing.
      </p>
      <p>
        If the sound device goes away mid-show — an interface unplugged, a driver that stops
        calling, another program taking exclusive access — the engine stops playing rather
        than pouring the show into a device that is no longer there. Every cue it was
        playing is released at that moment and records <em>audio device lost</em> under
        <strong>Last run</strong>, and what happened is on screen in the engine's own words:
        the monitor's alarm strip, the alarm chip in the transport bar, and the log. The
        show is not over — the cues it was playing were released, and Settings → Audio is
        where the engine's own readout says what it made of the device.
      </p>
      <p>
        When the interface is back — plugged in again, the other program gone, the driver
        calling again — <strong>Reconnect device</strong> in Settings → Audio reopens it.
        The panel sends the settings the show already holds, so nothing has to be changed to
        make the engine try the device again. A device that is already playing is left
        alone; when one is reopened, the reading above the control follows there and then —
        the device is listed, the failure text is gone — and the next GO plays through it.
        The alarm the loss raised is not the reconnect's to take down: it stands in the
        alarm strip until it is dismissed there. A reconnect the engine will not honour
        says so in the engine's own words, and the device that was playing is put back
        rather than quietly swapped for a lesser one.
      </p>
      <p>
        A cue that failed also says so in its own inspector, under <strong>Last run</strong>:
        when it ran, how long it took, and what went wrong. If a cue "does nothing", that
        is the first place to look, then the log.
        <a href="../reference/troubleshooting.html">Troubleshooting</a> lists the usual
        causes.
      </p>
    </section>

    <section class="panel reveal delay-2">
      <h2>Before the house opens</h2>
      <ol class="steps">
        <li><strong>Open the show and press GO once</strong> on a cue you can afford to hear. It proves the file, the device and the routing in one press.</li>
        <li><strong>Check the device</strong> in Settings → Audio: the right output, and the engine reporting no dropouts.</li>
        <li><strong>Look for missing media.</strong> A cue whose file has moved says <em>missing</em> where its length should be, and a bar across the top offers to relink it.</li>
        <li><strong>Arm what should run.</strong> Anything disarmed is skipped without warning — that is the point of it, so it is worth a look down the list.</li>
        <li><strong>Save.</strong> The dot beside the show's name means there are unsaved changes.</li>
        <li><strong>With a backup machine rigged</strong>, check the pair is in sync in Settings → Backup machine before the audience is in.</li>
      </ol>
      <div class="note">
        Keep the run log open on a second monitor if you have one. It is the difference
        between "the video did not fire" and "the video machine refused the request at
        19:42".
      </div>
    </section>
`
  },

  {
    path: 'guides/console.html',
    section: 'Guides',
    title: 'Firing cues from a console',
    blurb: 'Let a lighting desk, sound desk, tablet or footswitch fire Cuerunner cues over OSC and MIDI, and see what arrives.',
    body: `
    <section class="panel reveal">
      <h1>Firing cues from a console</h1>
      <p class="doc-lede">
        Somebody else presses GO: the lighting desk, a footswitch, a tablet, the stage
        manager's cue light panel. Cuerunner listens, and a cue can carry its own trigger.
      </p>
    </section>

    <section class="panel reveal delay-1">
      <h2>1. Let it listen</h2>
      <p>
        Settings → <strong>Network</strong> → <strong>OSC control</strong> is on by default
        and listens on port 53000. Settings → <strong>MIDI</strong> →
        <strong>Listen to MIDI</strong> opens the inputs you tick, or all of them if you
        tick none.
      </p>
      <p>
        The <strong>Monitor</strong> tab in the dock shows what is listening and what has
        arrived, so you can point the desk at Cuerunner and watch the messages land before
        writing a single trigger.
      </p>
      <figure class="figure">
        <a href="../assets/guide/12-show-monitor.png" target="_blank" rel="noreferrer">
          <img src="../assets/guide/12-show-monitor.png" alt="The show monitor: the services that are listening, what each is doing, and the devices they know about." />
        </a>
        <figcaption>The monitor: what is listening, and what it has heard.</figcaption>
      </figure>
    </section>

    <section class="panel reveal delay-1">
      <h2>2. Give a cue a trigger</h2>
      <figure class="figure shot-narrow">
        <a href="../assets/guide/14-triggers.png" target="_blank" rel="noreferrer">
          <img src="../assets/guide/14-triggers.png" alt="The Triggers tab: an OSC address, a MIDI note, and a show control command, each with a Learn button." />
        </a>
        <figcaption>The Triggers tab of a cue.</figcaption>
      </figure>
      <p>
        Select the cue, open <strong>Triggers</strong>, and add one:
      </p>
      <ul class="tight-list">
        <li><strong>OSC</strong> — an address, such as <code>/eos/cue/12/fire</code>. Arguments are ignored; the address is the trigger.</li>
        <li><strong>MIDI</strong> — a note, a controller or a program change on a channel. A note fires whatever its velocity.</li>
        <li><strong>Show control</strong> — an MSC command from a desk, matched on every field it sent.</li>
      </ul>
      <p>
        <strong>Learn</strong> is the shortcut: press it, then send the message from the
        desk, and the fields fill in with whatever arrived. A cue with a trigger shows a
        count on its Triggers tab, so a glance down the list tells you which cues answer
        to something other than a finger.
      </p>
      <div class="note">
        A trigger fires the cue exactly as GO would, including its pre-wait and its
        advance. A disarmed cue ignores its triggers, which makes disarming a safe way to
        take a cue out of a show that a console is driving.
      </div>
    </section>

    <section class="panel reveal delay-2">
      <h2>3. Panic from the rig</h2>
      <p>
        Two messages panic the show whoever sends them, with no cue written for them: OSC
        <code>/cuerunner/panic</code>, and MIDI <strong>All Sound Off</strong> — controller
        120 at value 0, on any channel of any port being listened to. A desk with a spare
        key, a footswitch, another program on the network: all of them can stop the sound.
      </p>
      <p>
        It is handled where the engine is rather than in the window, so it works even if
        the interface is busy, and the run log records who asked.
      </p>
    </section>

    <section class="panel reveal delay-2">
      <h2>Repeats</h2>
      <p>
        A footswitch that bounces, a desk that sends twice, a key held down: Settings →
        General → <strong>Repeat guard</strong> ignores a second GO arriving within the
        window you set. 300 ms by default; 0 turns it off.
      </p>
    </section>

    <section class="panel reveal delay-3">
      <h2>Next</h2>
      <p>
        The <a href="../reference/control.html">control reference</a> lists every message
        Cuerunner answers to and every field a trigger can match.
      </p>
    </section>
`
  },

  {
    path: 'guides/desk.html',
    section: 'Guides',
    title: 'Scenes and the desk',
    blurb: 'Build a scene grid of who rides which fader, recall it from a cue, and let Cuerunner write the membership and the mutes it names.',
    pro: true,
    body: `
    <section class="panel reveal">
      <h1>Scenes and the desk<span class="pro">Pro</span></h1>
      <p class="doc-lede">
        Who rides which fader, scene by scene, as a grid you can read from the back of the
        room — and a cue that moves the desk to match.
      </p>
    </section>

    <section class="panel reveal delay-1">
      <h2>1. Tell Cuerunner about the desk</h2>
      <p>
        <strong>Cuerunner ▾ → Show Settings… → Channels</strong>. Pick how the desk is
        reached — OSC, MIDI, or MIDI over TCP — and the address or port it answers on. A
        MIDI-over-TCP desk is dialled at the port beside its address — 51325 is what an SQ
        and an Avantis both serve their MIDI on. The line under it reads back exactly what
        Cuerunner will send, so you can check it against the console's own documentation
        before anything is live.
      </p>
      <div class="note">
        An SQ is reached on a second port, and the two carry different facts. Its MIDI
        service — 51325, or a MIDI port — takes the channel mutes. Its <strong>own control
        service</strong> — TCP 51326 outbound, held open by Cuerunner with a keepalive
        datagram to the desk's UDP 51324 and a ping on the socket — takes the membership,
        and there is no other route that does: an SQ reached over a plain MIDI port can be
        muted and assigned nothing. None of that is a setting: 51326 is the desk's own port,
        and the cadence is Cuerunner's.
      </div>
      <figure class="figure">
        <a href="../assets/guide/19-show-settings.png" target="_blank" rel="noreferrer">
          <img src="../assets/guide/19-show-settings.png" alt="Show Settings on its Channels tab: the desk connection, the channel strips with a Count beside their heading, the faders the show drives with one beside theirs, and the rule under them that allows a channel to ride more than one fader." />
        </a>
        <figcaption>The desk, the strips on the console and the faders the show drives, each list with its Count — and the rule under the faders.</figcaption>
      </figure>
      <p>
        Then list the <strong>channels</strong> — the strips on the console, a name and a
        number each — and the <strong>faders</strong> the show drives, each with its own
        <strong>Count</strong> beside the heading: set it to the desk's size and the list is
        that long at once, so a show set up too large is one press from the right size. The
        two counts go different ways on the way down. A <strong>strip</strong> that goes
        leaves every scene and unpatches whoever was on it: a placement naming a strip that
        is gone is a cell nobody can read again, and a mic pointed at one opens nothing. A
        <strong>fader</strong> that goes takes every scene's row for that place with it and
        unpatches nobody — the mics stay where they are, and a fader grown back comes back
        empty. Which channel rides which fader is not set up here: that is the scene's
        decision, taken in the grid, so a chorus can ride one fader in one number and be
        split across the stage in the next. A fader is its <strong>number</strong> — the
        fourth fader of the show is its fourth fader in every scene, and the grid's rows are
        named by that number — and each carries one <strong>desk number</strong>, for a desk
        that counts its DCAs differently from the show. The row under it says how many
        scenes put anything on it. Under the faders are the two rules the grid cannot
        state for itself. <strong>Allow a channel to ride more than one fader</strong>: left
        on, a strip rides as many faders as a scene places it on; switched off, the grid keeps
        one fader per channel and a recall folds a leftover down to the lowest-numbered one.
        <strong>Highest fader wins</strong>, on an SQ over the network: a desk adds every DCA a
        channel is on, so a second fader at -inf silences it; with this on, the channel rides
        only the highest of its faders and moves as they cross — so a lead on their own fader
        and on the cast's stays where their own fader has them while the cast's comes up, and
        lands on the cast's when theirs is pulled below it.
        The line under the desk connection reads the desk's own ceiling back too, so a show
        larger than the desk model states is named there, with the number, and sent as it is.
      </p>
      <div class="note">
        Fields this tab used to carry are deleted rather than deprecated: a strip has no
        fader select of its own, a fader has no <strong>name</strong> — one
        <strong>desk number</strong> in place of the note and address overrides that used to
        sit beside it — and a scene's row holds one thing rather than a list of them. A show
        saved with any of those shapes is refused when it is opened, naming what the build
        does not know, rather than converted — the strips, the faders and the placements are
        set up again here and in the grid.
      </div>
    </section>

    <section class="panel reveal delay-1">
      <h2>2. Enter the cast</h2>
      <p>
        <strong>Cast</strong> is the people: a name, a part, the channel they are on and any
        note you need. A performer is who they are for the whole show — the mic plot hands
        them packs and the report names them the next morning — so this is where they are set
        up and nothing else is. The groups they are opened in belong to the grid: build them
        from the strips a row should carry, where you are standing when you decide who is in
        the chorus.
      </p>
    </section>

    <section class="panel reveal delay-2">
      <h2>3. Build the scenes</h2>
      <figure class="figure">
        <a href="../assets/guide/18-scenes.png" target="_blank" rel="noreferrer">
          <img src="../assets/guide/18-scenes.png" alt="The scenes view: the show's faders down the side and scenes across the top, each row holding one strip or one ensemble, which is the press that changes it." />
        </a>
        <figcaption>The scenes view, mid-build.</figcaption>
      </figure>
      <p>
        Switch the window to <strong>Scenes</strong> and unlock the <strong>padlock</strong>
        in the grid’s top-left corner; the <strong>+</strong> after the last scene adds one.
        The show’s <strong>faders</strong> run down the side — numbered, because that is
        what the desk is told and what you reach for — and the scenes across the top. Each
        row of a scene holds <strong>one thing</strong>: a strip, or an ensemble over several
        of them. An empty row is a blank box — press it, type a name into the
        <strong>filter</strong>, and pick the strip or the group. A row that holds something
        is that name, using the whole cell: press it to put something else there, and the ✕
        beside it to empty the row. A strip can ride several faders — a chorus master on one
        and its members spread across others — unless Show Settings has that turned off
        (Channels → Allow a channel to ride more than one fader), where putting a strip on a
        row takes it off that scene's other rows.
      </p>
      <p>
        Several strips on one fader is what an <strong>ensemble</strong> is for, and
        <strong>Ensemble…</strong> — the last row of the box — is where one is built or
        changed: name it, move the strips it should hold from <strong>Available</strong> to
        <strong>In the ensemble</strong> with the two arrows, and press <strong>Create and
        apply</strong>. The group is put on this row, and it is left there to put on other rows
        and scenes with the same box. Opened from a row that already holds a group it edits that
        group instead — <strong>Save</strong> changes it on every row that
        holds it, because an ensemble is membership rather than a copy, and
        <strong>Delete</strong> removes it and empties those rows. A group holds
        <strong>strips</strong>, so any strip of the show can be moved across whether or not
        anybody is cast on it — a rack of playback channels is a group like any other.
        Lock the padlock again when you have finished.
      </p>
      <p>
        A scene answers for every channel, not only for the ones it places: a channel it
        leaves off every fader in that scene is closed by the recall. An ensemble's block
        says which mics it opens in its title. The leftmost column,
        <strong>Out</strong>, is a scene like any other that way — it places nothing,
        so it closes every mic the show drives — and it is the one column that is never
        edited. Columns are a fixed width — an eighteen-character scene name is what one is
        measured for — so a show of two scenes reads the same as a show of twenty: what does
        not fit across the window scrolls inside the grid.
      </p>
      <p>
        The grid has two modes, and the <strong>padlock</strong> in its top-left corner is
        the one press that changes them: shut, the show is being run and a stray click
        changes nothing but which scene is recalled; open, cells and names are the show being
        built and the presses that change it are drawn. Recalling is live in either mode:
        press <strong>Recall</strong> on a scene and the desk moves. The column the desk is
        on carries the running colour down its own header, so the grid always says where you
        are.
      </p>
      <p>
        A recall sends what has changed since the desk was last told, so the grid is safe to
        press twice. What it cannot do is see the desk itself: a fader or a mute moved by hand
        is invisible here, and the record of what has been sent lives for as long as the show
        is open — reopening it is what starts the next recall from the whole scene.
      </p>
    </section>

    <section class="panel reveal delay-2">
      <h2>4. Put a scene in the cue list</h2>
      <p>
        Add a <strong>Scene</strong> cue (toolbar → More) and point it at a scene. GO now
        moves the desk as part of the show.
      </p>
      <p>
        A recall sends two facts and no others: the <strong>membership</strong> — the
        channels the scene places on each fader, and the faders it takes them off — and then
        each mic’s <strong>mute</strong>. The order matters twice over. The membership comes
        first because it is what a mute is a state <em>of</em>: a channel the scene has just
        placed and opened is opened on the fader it was put on. And a mic whose fader changes
        keeps playing — it takes the new fader’s position and is never muted on the way
        there. Neither fact names a channel outside the show’s own set: the strips Show
        Settings → Channels lists are the boundary, and a mute carries the channel’s own
        number and never a fader’s, because a fader is a control group and closing one is not
        how a mic is silenced.
      </p>
      <p>
        What goes out is only what changes, diffed against what Cuerunner last sent, and each
        write is remembered as it lands. Mics an earlier recall already opened are left
        alone, so a recall never bumps a live channel and a scene cue is safe to fire twice.
        Nothing here can see a fader or a mute somebody moved by hand at the desk: a recall
        sends only what has changed since Cuerunner last sent, so a channel it believes is
        already closed cannot be closed from here. Reopening the show forgets that record, and
        the next recall writes every channel the scene controls.
      </p>
      <p>
        The membership goes over whatever route the show’s desk takes it on: an SQ reached
        over MIDI over TCP has it written on its own control service, TCP 51326, and an
        Avantis takes it as NRPN <code>40</code> on the desk link. A desk with no such route
        — a note desk, an OSC desk, or an SQ reached over a plain MIDI port — reports the gap
        and writes the mutes anyway rather than going quiet.
      </p>
      <div class="note">
        A scene cue with no scene chosen does nothing rather than closing every mic on the
        desk. That is deliberate: the dangerous reading of an empty scene is "close
        everything", and it is never what anyone meant.
      </div>
    </section>

    <section class="panel reveal delay-3">
      <h2>5. Run it from the desk’s own keys</h2>
      <p>
        A console only reports a key press when the key is assigned to something the console
        can name, so Cuerunner reads GO and BACK from two <strong>mute groups</strong> — or
        from two <strong>MIDI notes</strong> beside them on the same Show Settings → Channels
        tab. Assign the groups to two spare keys at the desk and pressing them walks the
        show’s scenes — GO to the next, BACK to the one before, in the order the Scenes view
        shows them.
      </p>
      <p>
        A group’s key toggles the group, so the desk’s indicator stays lit — which is what
        you want when the light itself is the cue that the show has moved. Where a press
        only ever means “next cue”, set a soft key to <strong>MIDI Note</strong> instead
        (<em>Setup → Surface → Soft Controls</em> on an SQ) and enter the number it
        transmits as the <strong>GO note</strong>. That key sends the note only while it is
        held, so the press steps the show once, the release does nothing, and nothing is
        left lit at the desk. An SQ’s soft keys transmit from 48 upward, one per key.
      </p>
      <div class="note">
        The note fields are offered on an SQ, whose own desk traffic Cuerunner cannot mistake
        for a hand on a key. On an Avantis the mute groups <em>are</em> notes and its surface
        keys latch, so the group route is the one to use there. Both routes arrive on the
        desk link — MIDI over TCP on 51325, or a MIDI port — which is the same connection a
        recall sends the mutes down; the SQ’s own control service on 51326 carries the
        membership and nothing a key press produces.
      </div>
    </section>
`
  },

  {
    path: 'guides/wireless.html',
    section: 'Guides',
    title: 'Watching the radio mics',
    blurb: 'Feed receiver telemetry into Cuerunner, keep a mic plot, and get an alarm before a battery dies mid-line.',
    pro: true,
    body: `
    <section class="panel reveal">
      <h1>Watching the radio mics<span class="pro">Pro</span></h1>
      <p class="doc-lede">
        Two questions, all night: who is wearing which pack, and which one is about to die.
      </p>
    </section>

    <section class="panel reveal delay-1">
      <h2>1. Point it at the rack</h2>
      <p>
        Settings → <strong>Wireless</strong> → <strong>Add source</strong>. A source is a
        <strong>Sennheiser EW-DX</strong> receiver, an <strong>HTTP</strong> address that
        returns the readings, or a <strong>file</strong> on disk that something else keeps
        up to date. An EW-DX receiver needs nothing in between; for anything else
        Cuerunner reads one simple JSON document, and anything that can produce it will do.
        <a href="../reference/formats.html#telemetry">The format is here</a>; it is about
        ten lines.
      </p>
      <p>
        <strong>Demo</strong> is a simulated twelve-pack rack with a pack in trouble, one
        low and one that never reports. It is there to see what the panel does without a
        receiver on the bench.
      </p>
    </section>

    <section class="panel reveal delay-1">
      <h2>Sennheiser EW-DX</h2>
      <p>
        Cuerunner talks to the receiver over the network, so the receiver and the show
        computer have to be on the same one. In <strong>WSM</strong>, turn on third-party
        access for the receiver and set its password. Then open Settings →
        <strong>Wireless</strong>: the receivers on the network are listed under <strong>On
        the network</strong>, and <strong>Add</strong> makes one a source and puts the
        cursor in its password box. The password is kept on this computer, not in the show,
        so a copy of the show does not carry it.
      </p>
      <p>
        It looks when you open that page and when you press <strong>Look again</strong>, and
        never in the background. Nothing is added by itself, and a show with no source here
        has no wireless alarms and sends nothing to the network. A receiver that does not
        appear can still be added by hand: <strong>Add source</strong>, choose
        <strong>Sennheiser EW-DX</strong>, and type its address.
      </p>
      <p>
        Each receiver is one source, and every channel with a transmitter linked to it
        appears as a pack: name, battery, signal and frequency. A channel with nothing
        linked shows nothing, so a pack patched to it counts as offline until it is
        switched on. Packs on AA cells report a percentage and no minutes remaining.
      </p>
      <p>
        The first time Cuerunner connects it remembers which receiver it is — the serial
        number printed on it — and the certificate it presented, and shows both under the
        source. If the receiver's address changes, Cuerunner looks for that serial on the
        network, carries on from wherever the receiver is now, and says so under the
        source; nothing needs re-entering, and the show still names the old address. If a
        <em>different</em> receiver turns up at the address, or the certificate changes,
        Cuerunner refuses to connect rather than trust it silently, and does not send it the
        password. Press <strong>Trust again</strong> when you have replaced the receiver.
      </p>
    </section>

    <section class="panel reveal delay-1">
      <h2>2. Enter the plot</h2>
      <p>
        The plot is optional. A channel that is reporting appears in the panel by itself,
        under the name its receiver gives it, so a receiver shows something the moment it
        is added. The plot is what you add when you want more than that:
        <strong>Show Settings → Mic plot</strong> is the rig as you know it — pack 4 is
        channel 4, and channel 4 is whoever is wearing it. It is the expectation, and it is
        what makes a pack that never reports an alarm rather than a blank row.
      </p>
      <p>
        A <strong>swap</strong> mid-show is a change of who is on which pack, recorded
        where the report can see it: change the performer on a pack row and the swap is
        logged with the time.
      </p>
    </section>

    <section class="panel reveal delay-2">
      <h2>3. Read it during the show</h2>
      <figure class="figure">
        <a href="../assets/guide/13-wireless.png" target="_blank" rel="noreferrer">
          <img src="../assets/guide/13-wireless.png" alt="The wireless panel: twelve packs with names, battery and RF bars, sorted with the pack in trouble at the top." />
        </a>
        <figcaption>Sorted by trouble, not by number.</figcaption>
      </figure>
      <p>
        The <strong>Wireless</strong> tab in the dock sorts by trouble rather than by
        number: critical battery first, then a pack that has gone quiet, then a low one,
        with everything healthy below. Each row carries the pack, the performer, battery
        and RF as bars and numbers, the frequency, and whether the channel is muted.
      </p>
      <p>The wording is exact, because the difference matters at 19:55:</p>
      <ul class="tight-list">
        <li><strong>Unpatched</strong> — no channel assigned. A patch waiting to be made, not an alarm.</li>
        <li><strong>Silent</strong> — assigned, but has never reported. The rack may still be booting, or the pack is off.</li>
        <li><strong>Offline</strong> — reported before, and has now stopped for longer than the threshold. This one raises an alarm.</li>
      </ul>
      <p>
        A Sennheiser EW-DX receiver also says what it itself complains of, and it is shown under
        the pack: <strong>encryption error — no audio</strong> is critical — the pack is linked
        and nobody hears it — and <strong>RF overload</strong> and <strong>audio clipping</strong>
        are worth knowing. Each raises one alarm when it appears, and clipping, which comes and
        goes by the second, at most once a minute.
      </p>
      <p>
        Alarms appear above the panel and in the transport bar, so a battery warning finds
        you even with the dock closed. The thresholds — battery low, battery urgent, signal
        weak, how long silence counts as offline — are in Settings → Wireless.
      </p>
    </section>

    <section class="panel reveal delay-2">
      <h2>4. Before the doors: the check</h2>
      <p>
        <strong>Check</strong> in the Wireless header answers one question: is every pack ready
        to be worn? It says so in a sentence — <em>All 12 packs ready</em> — or lists the ones
        that are not, the ones that would fail first at the top, each with its performer and
        why.
      </p>
      <ul class="tight-list">
        <li><strong>Not ready</strong> — not reporting, stopped reporting, a battery at the urgent line, or a critical complaint from the receiver such as a key that does not match.</li>
        <li><strong>Worth a look</strong> — a battery at the low line, a weak signal, clipping, a pack muted at the receiver, or a pack with no channel patched.</li>
        <li><strong>A charge that will not last</strong> — a pack that is fine now but started lower than a show costs it: <em>battery 40% — a show used 24% last time</em>.</li>
      </ul>
      <p>
        That last one comes from what each pack used in the shows before, which Cuerunner keeps on
        this computer. A stretch of continuous reporting is one session; a pack that goes quiet for
        twenty minutes was switched off, and a jump of ten points is fresh batteries, so either
        starts a new one. It reads the worst of the last three, asks for a quarter more than that,
        and keeps the urgent line spare. The gauge on AA cells is noisy, so a session shorter than
        twenty minutes, or one that used only a point or two, says nothing. The report shows it
        beside each pack's lowest battery.
      </p>
      <p>
        It is live, so it turns green as you switch a pack on or change a battery, and
        <strong>Copy</strong> puts it in a form you can paste to whoever is on the deck. It never
        stops a GO — Cuerunner does not hold playback for anything — it is the question you ask at
        the half, and the person who can see the stage decides.
      </p>
    </section>

    <section class="panel reveal delay-2">
      <h2>5. Muting from the cue list</h2>
      <p>
        A <strong>Mic</strong> cue (the <strong>+</strong> menu) mutes or unmutes one Sennheiser
        EW-DX mic at its receiver, so the pack that is offstage for the scene is closed by the cue
        list and not by a hand on a fader. Choose the mic from the packs the show knows — by the
        plot and who is wearing the pack, or by what the receiver calls the channel — and whether
        the cue should <strong>Mute</strong> or <strong>Unmute</strong>.
      </p>
      <ul class="tight-list">
        <li><strong>There is no toggle.</strong> A toggle run twice leaves the mic as the first run found it, and a cue list you can jump around in cannot know which that was.</li>
        <li><strong>It asks afterwards.</strong> The receiver is read back, and a mute that did not happen is an error on the cue — in the log and on its row — never a mic left open in silence.</li>
        <li><strong>It is a channel, not a person.</strong> A pack that changes hands keeps its channel, so the cue keeps muting the same mic.</li>
        <li>With no mic chosen the cue does nothing and says so. Scrubbing into the middle of a timeline does not replay a mute that is already behind you.</li>
      </ul>
    </section>

    <section class="panel reveal delay-2">
      <h2>6. The report</h2>
      <figure class="figure">
        <a href="../assets/guide/17-report.png" target="_blank" rel="noreferrer">
          <img src="../assets/guide/17-report.png" alt="The wireless report: each pack with its lowest battery, worst RF and any swaps during the session." />
        </a>
        <figcaption>What the session leaves behind.</figcaption>
      </figure>
      <p>
        <strong>Report</strong> switches the panel to what the session recorded: the lowest
        battery each pack reached, its worst signal, and the swaps that were made. It is
        the thing to look at after a show that had a dropout, and the thing to hand over
        when somebody else takes the rig.
      </p>
      <p>
        Under a pack that had trouble, each incident has its time and what was playing:
        <em>20:14 went quiet during cue 47 Walk-in</em>, or <em>between cues</em> when nothing
        was. A pack going quiet, its signal turning weak and a new complaint from the receiver
        are each noted, against the cue that was live at that moment. The report covers a
        channel that is in no plot as well, so a show that never entered one can still ask
        what the night did to its packs. Like the rest of the session it starts over when
        Cuerunner does, so copy it before you quit.
      </p>
    </section>
`
  },

  {
    path: 'guides/script.html',
    section: 'Guides',
    title: 'Following the script',
    blurb: 'Load the script beside the cue list, pin cues to the lines they fire on, and put the same view on a tablet.',
    pro: true,
    body: `
    <section class="panel reveal">
      <h1>Following the script<span class="pro">Pro</span></h1>
      <p class="doc-lede">
        The book, beside the cue list, with the cues pinned to the lines they go on.
      </p>
    </section>

    <section class="panel reveal delay-1">
      <h2>1. Load the script</h2>
      <p>
        The <strong>Script</strong> tab in the dock, then <strong>Choose file…</strong>.
        A plain text file is what it wants; the lines are numbered as they are read, and
        the file is left alone — Cuerunner keeps the pins, not the script.
      </p>
      <figure class="figure">
        <a href="../assets/guide/15-script.png" target="_blank" rel="noreferrer">
          <img src="../assets/guide/15-script.png" alt="The script panel: numbered lines of a script with a cue pinned to one of them." />
        </a>
        <figcaption>A cue pinned to the line it fires on.</figcaption>
      </figure>
    </section>

    <section class="panel reveal delay-1">
      <h2>2. Pin the cues</h2>
      <p>
        Select a cue, then click the line number it goes on. The cue's number appears
        beside that line, and the panel now reads like a marked-up book. Clicking a pin
        selects that cue, so the script becomes a way to navigate the show.
      </p>
      <p>
        <strong>A− / A+</strong> change the text size; the panel remembers it. The pins are
        saved with the show.
      </p>
    </section>

    <section class="panel reveal delay-2">
      <h2>3. Follow along</h2>
      <p>
        As the show runs, the panel keeps the line of the cue that just fired in view, so
        the book follows the show without a hand on it.
      </p>
    </section>

    <section class="panel reveal delay-2">
      <h2>4. Put it on a tablet</h2>
      <p>
        Settings → <strong>Network</strong> → <strong>Tablet view</strong>. Switch it on,
        set an access code, and open the address it reports in a browser on the same
        network. It shows the cue list and the script, and follows the show.
      </p>
      <div class="note">
        The tablet watches. It cannot fire a cue, edit the show, or stop anything — which
        is what makes it safe to hand to a stage manager or a DSM in the middle of a
        performance.
      </div>
    </section>
`
  },

  {
    path: 'guides/showfile.html',
    section: 'Guides',
    title: 'Versions and handover',
    blurb: 'What each save changed, comparing two versions of a show, merging two people\'s work, and handing the whole thing over as one file.',
    body: `
    <section class="panel reveal">
      <h1>Versions and handover<span class="pro">Pro</span></h1>
      <p class="doc-lede">
        A show is worked on over weeks, by more than one person, and then handed to
        somebody else to run. These are the four things the file itself can tell you and
        do for you.
      </p>
    </section>

    <section class="panel reveal delay-1" id="history">
      <h2>1. What the file remembers</h2>
      <p>
        Every save that changes the show writes a line into the file: who saved it, when,
        and what moved — the cues added, removed, edited and moved, and the settings that
        changed. <strong>Cuerunner &#9662; &rarr; Show History&hellip;</strong> reads those
        lines back, newest first, with the detail of each entry behind a disclosure.
      </p>
      <p>
        A save that changes nothing writes the same bytes back and adds no line, which is
        what makes a showfile safe to keep in version control: a show opened, saved and
        closed without an edit is the same file. A save also checks the file it is about
        to replace: if what is on disk is not what this window opened or last wrote — a
        colleague saved the show on the share — it asks whether to overwrite that file or
        to leave it alone and keep the show unsaved, rather than replacing an edit it never
        saw. A measurement the app took since the file was written — a file's length, the
        audible region inside it — is the one thing that can still change the bytes: it is
        not an edit, so it adds no line, and a show whose media was scanned between two
        saves compares as unchanged. Show files are not converted, so no save records one, and
        a file this build does not know is refused. The shape is declared and checked, and an
        older file — one that leaves out a settings section this build writes — is refused by
        name as it opens. A file remembers its last two hundred changes and lets the oldest
        fall off.
      </p>
      <div class="note">
        The history lives in the <code>.cuerunner</code>, so it survives being copied, emailed
        or handed over. It is written whether or not this machine is licensed — it is the
        show's own record of itself — and reading it back is free. What the key turns on is
        comparing this file with another and merging two people's work.
      </div>
    </section>

    <section class="panel reveal delay-1" id="compare">
      <h2>2. Comparing two versions</h2>
      <p>
        <strong>Cuerunner &#9662; &rarr; Compare Show&hellip;</strong> takes another saved
        show and says what changed from it to the show on screen: the cues added, the cues
        removed, the cues edited with the fields that changed, the cues that moved, and the
        settings that moved with them. The file you pick is the older side, so read the
        heading as "what changed since this was written" — the version from last night's
        rehearsal against the one you are holding.
      </p>
      <p>
        The comparison is about the show rather than about the machine: the audio file a
        cue plays is compared by the file's own name, so a show copied into another folder,
        or onto another machine, does not read as every cue having been edited.
      </p>
    </section>

    <section class="panel reveal delay-2" id="merge">
      <h2>3. Merging two people's work</h2>
      <p>
        <strong>Cuerunner &#9662; &rarr; Merge Show&hellip;</strong> merges another person's
        copy of the show into yours, and asks for the version the two of you started from.
        That third file is not bookkeeping: with two files alone, "I changed this" and "you
        changed it" look the same, and a merge that cannot tell them apart throws one
        person's work away.
      </p>
      <p>
        A cue one side changed is taken. A cue both sides changed in different fields is
        put together. A cue both sides changed in the same field is a conflict: the merge
        keeps one side's value and names the conflict — the cue, both values, and whose was
        kept — rather than deciding quietly. The order is this show's, with the other
        side's cues placed among the neighbours they were added after, and groups stay
        together.
      </p>
      <p>
        What a merge will not pretend to do is said rather than guessed: the audio file a
        cue plays is this show's, because the other copy resolved its media on the other
        machine; a cue whose group went away comes back at the top level; and each of those
        is listed in the report.
      </p>
      <div class="note">
        The merge writes a <strong>new</strong> file and leaves both inputs exactly as they
        were, so it is safe to try twice. The report's second button runs the same merge
        over the same two files again with the other side's choices for the conflicts.
      </div>
    </section>

    <section class="panel reveal delay-2" id="bundle">
      <h2>4. Handing a show over as one file</h2>
      <p>
        <strong>Cuerunner &#9662; &rarr; Export Bundle&hellip;</strong> writes the show and
        every audio file it plays into one <code>.cuerunnerx</code>: a zip holding
        <code>show.cuerunner</code> and a <code>media/</code> folder, with the showfile pointing
        inside it. It opens in any file manager, and its bytes are a function of the show,
        so two exports of the same show are the same file. A file the show names that is
        not on this machine is reported rather than failing the export.
      </p>
      <p>
        <strong>Import Bundle&hellip;</strong> asks where the show should live, unpacks it
        there and opens it: the audio is in the folder beside the showfile, so every cue
        plays without anything to relink. If the folder already holds files by those names,
        the app asks before replacing them. A bundle whose contents do not match the
        checksums it carries is refused rather than half-unpacked.
      </p>
      <p>
        A bundle carries up to about 4 GB of media — the zip format's own limit without its
        64-bit extension, which this app does not write. A show bigger than that says so
        instead of being written as an archive that lies about its own contents; the
        <code>.cuerunner</code> itself has no such limit, and a show that size can still be
        moved by <a href="../reference/formats.html#workspace">copying its folder</a>.
      </p>
    </section>
`
  }
]
