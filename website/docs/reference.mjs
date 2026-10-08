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
  { tab: 'timecode', anchor: 'timecode' },
  { tab: 'license', anchor: 'license' },
  { tab: 'updates', anchor: 'updates' }
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
          <p>Every type, every field, and what each one defaults to.</p>
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
          <p>The <code>.cuerunner</code> workspace, media paths, QLab workspaces, and the wireless telemetry document.</p>
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
        Every type carries the common fields below, and then its own.
      </p>
    </section>

    <section class="panel reveal delay-1" id="common">
      <h2>Every cue</h2>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Field</th><th>Default</th><th>What it does</th></tr></thead>
          <tbody>
            <tr><td>Number</td><td>next free</td><td>Text, not a position. <code>12.5</code> and <code>LX 12</code> are both valid, and inserting a cue renumbers nothing. A duplicate is a new cue and takes the next free number too, as does every cue inside a duplicated group.</td></tr>
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
            <tr><td>Fade out</td><td>0 s</td><td>Ramps down to silence over this long so that the ramp ends where the cue does: the end of its region, or of its last loop. The engine times it from the cue's planned end, and a seek or a rate change moves it with the end. A cue that loops for ever has no end to land on; fade it with a fade or stop cue. STOP still cuts at once.</td></tr>
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
              <td><strong>Duration</strong>, in seconds to the hundredth. Holds for that long. Set Advance to On end to fire the next cue afterwards.</td>
            </tr>
            <tr>
              <td><strong>Fade</strong></td>
              <td><strong>Target</strong> (an audio, video, image, text or camera cue, or a Light cue), <strong>Property</strong> (volume, pan, or volume and pan together — a <strong>Target pan</strong> beside the volume, both on the one time and curve; <strong>opacity</strong> or <strong>geometry only</strong> for a picture — a video has all of them, an image, text or camera only the picture's; a Light cue's is its intensity; a picture fade's <strong>Move the picture</strong> ticks the position, scale, rotation and crop it moves, each to its own target, from wherever the picture is when the fade starts), <strong>Target value</strong> (0 to 1 for a volume or an opacity, −1 left to 1 right for a pan), <strong>Duration</strong>, <strong>Curve</strong> (linear, S-curve, logarithmic) and <strong>Stop when done</strong> — which makes it a fade-out. On a Light cue the target value is a share of the intensity the cue set: 0 is out, 1 is where the cue put it, and stopping it when done releases the cue.</td>
            </tr>
            <tr>
              <td><strong>Stop</strong></td>
              <td><strong>Target</strong> (a cue, or All cues), <strong>Fade out</strong> with a <strong>duration</strong>, and <strong>Wait for fade</strong>, which holds the show until the fade has finished instead of completing as soon as the target is told to stop. A Light cue stopped without a fade-out stays on where its fade had got to; with one, what it holds fades home over the fade-out.</td>
            </tr>
            <tr>
              <td><strong>Devamp</strong></td>
              <td><strong>Target</strong> — a looping audio or video cue. It lets go of the lap it is on and plays out to the end of its file; a video's picture with its sound.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="panel reveal delay-2" id="pictures">
      <h2>Video, Image, Text and Camera</h2>
      <p>
        The picture cues. Each shows on a video output (see <a href="./settings.html#outputs">Outputs</a>)
        and carries the <strong>Picture</strong> fields; each has its own tab for what it shows,
        and a video has a <strong>Sound</strong> tab. How they behave together is in the
        <a href="../guides/video.html">video guide</a>.
      </p>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Picture field</th><th>Default</th><th>What it does</th></tr></thead>
          <tbody>
            <tr><td>Output</td><td>the first output</td><td>Which output the picture goes to. A cue naming an output the show no longer has fails and says so.</td></tr>
            <tr><td>Layer</td><td>1</td><td>Stacking order, −1000 to 1000: higher is in front. On one layer the later firing is in front.</td></tr>
            <tr><td>Opacity</td><td>100%</td><td>The level the picture rests at. Applies at once while it is up; a fade cue moves it over time.</td></tr>
            <tr><td>Fade in</td><td>0 s</td><td>From the picture's first frame on screen to its opacity.</td></tr>
            <tr><td>Fade out</td><td>0 s</td><td>Lands on the picture's own end: a video's last pass, an image's or text's display time. Nothing to land on — a video looping for ever, a picture held until stopped — and it does nothing.</td></tr>
            <tr><td>Crossfade</td><td>off</td><td>Video and image. Dissolves in from what is on the output at or below this layer, over the fade in, as an exact mix of the two frames; what it replaced is taken down and its cue stopped when it lands. With nothing to dissolve from it fades up.</td></tr>
            <tr><td>Size to</td><td>Fit</td><td><strong>Fit</strong> (all of it, letterboxed), <strong>Fill</strong> (the whole output, cropped), <strong>Stretch</strong> (to the output's shape) or <strong>Native</strong> (one pixel per pixel). Text is always native.</td></tr>
            <tr><td>Position</td><td>0%, 0%</td><td>The picture's centre, right of and below the output's centre, as a share of its width and height.</td></tr>
            <tr><td>Scale</td><td>100%</td><td>A multiple of the fitted size, 1% to 1000%.</td></tr>
            <tr><td>Rotate</td><td>0°</td><td>Clockwise, about the picture's own centre.</td></tr>
            <tr><td>Crop</td><td>0%</td><td>Video, image and camera: cut from the top, right, bottom and left before the picture is fitted.</td></tr>
            <tr><td>Blend</td><td>Normal</td><td>How the picture is laid over what is behind it: Normal, Multiply, Screen, Overlay, Darken, Lighten, Colour dodge, Colour burn, Hard light, Soft light, Difference, Exclusion, Add or Subtract, at the picture's opacity. The same on the GPU and the 2D fallback. Applies at once while it is up.</td></tr>
            <tr><td>Next GO</td><td>the show's default</td><td><strong>Takes it down</strong> — over its own fade out — on the next GO, whatever that GO fires; <strong>Leaves it up</strong>; or the show's default (the Outputs panel's <strong>Next GO</strong>, off unless set). A GO from a trigger or a desk counts, but only a GO in the picture's own cue list; a picture the GO's own crossfade is dissolving is left to the dissolve.</td></tr>
            <tr><td>Keyframes</td><td>none</td><td>Up to 32 places the picture moves to over its own play: each a time from its first frame (pauses taken out), a position, scale, rotation and crop, and how it is reached — Linear, Ease in, Ease out, Ease in and out, or Jump. From the cue's own geometry at nought; it stays at the last.</td></tr>
          </tbody>
        </table>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Type</th><th>Fields</th></tr></thead>
          <tbody>
            <tr>
              <td><strong>Video</strong></td>
              <td><strong>File</strong> (MP4, MOV, M4V, WebM, MKV, OGV — what Chromium decodes), <strong>Start time</strong> / <strong>End time</strong> (0 / end of file), <strong>Loop count</strong> (0 once, n more times, −1 until stopped or devamped), <strong>Hold last frame</strong> (off; on, the cue runs until it is stopped) and, while it plays, <strong>Pause</strong>/<strong>Resume</strong> and <strong>Position</strong>. On <strong>Sound</strong>: <strong>Volume</strong> (100%), <strong>Pan</strong> (centre) and <strong>Routing</strong> — the sound is an engine voice exactly as an audio cue's is. Its length is measured from the file, like an audio cue's.</td>
            </tr>
            <tr>
              <td><strong>Image</strong></td>
              <td><strong>File</strong> (PNG, JPEG, GIF, WebP, BMP, SVG, AVIF) and <strong>Shown for</strong> (empty holds it until it is stopped).</td>
            </tr>
            <tr>
              <td><strong>Text</strong></td>
              <td><strong>Text</strong> (one block, new lines kept), <strong>Font</strong> (IBM Plex Sans; a font this computer does not have falls back), <strong>Size</strong> (96 px, in the output's own pixels), <strong>Colour</strong> (white), <strong>Bold</strong>, <strong>Italic</strong>, <strong>Position</strong> (one of nine; centre) and <strong>Shown for</strong>.</td>
            </tr>
            <tr>
              <td><strong>Camera</strong></td>
              <td><strong>Source</strong>: <strong>A camera on this machine</strong> (a capture device the outputs can see — webcam, USB, HDMI capture; the show keeps its name, this computer its exact device) or <strong>A network stream</strong> with an <strong>Address</strong> (HTTP video, HLS <code>.m3u8</code> or MJPEG; a login in the address is passed on; RTSP is refused). Fills its output (Size to <strong>Fill</strong>) and runs until it is stopped. A camera that is not connected is said across the output and on its card, and comes up when it is plugged in; with no camera chosen, or an RTSP address, the cue fails and says why.</td>
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
            <tr><td>Random</td><td>One child, drawn at random — every child once before any of them twice, and never the same one twice running across the seam between passes.</td></tr>
            <tr><td>Timeline</td><td>Each child at its own offset, edited by dragging in the dock.</td></tr>
          </tbody>
        </table>
      </div>
      <p>
        A group's duration is worked out from its children. Stopping a group stops them
        too.
      </p>
    </section>

    <section class="panel reveal delay-2" id="light">
      <h2>Light<span class="pro">Pro</span></h2>
      <p>A look for the lighting rig, faded in over sACN or Art-Net. The rig itself is set up in the <a href="../guides/lighting.html">Lighting view</a>.</p>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Field</th><th>Default</th><th>What it does</th></tr></thead>
          <tbody>
            <tr><td>Fade</td><td>3 s</td><td>How long the look takes to arrive. It is the cue's duration: the run ends, and On end advances, when the fade does. Up to an hour.</td></tr>
            <tr><td>Curve</td><td>Linear</td><td>Linear, S-curve or logarithmic — the shapes an audio fade takes.</td></tr>
            <tr><td>Intensity</td><td>Latest takes precedence</td><td><strong>Latest takes precedence</strong>: the cue takes every parameter it sets from whichever cue had it. <strong>Highest takes precedence</strong>: its intensity sits beside every other such cue's, and the light is the brightest of them and of the tracked level. Colour and position are latest takes precedence either way.</td></tr>
            <tr><td>Look</td><td>empty</td><td>Levels, 0–100%: a fixture's parameter, or a group's — reaching every member that has it. A later line for the same parameter wins. A fixture removed from the rig is shown as gone and sends nothing. What the look does not name tracks: it stays where earlier cues left it.</td></tr>
            <tr><td>Effects</td><td>none</td><td>A parameter that keeps moving after the fade: sine, triangle, square or saw, between a low and a high, 0.01–25 cycles a second. On a group, <strong>spread</strong> shares a cycle out across the members — 100% is a chase. A later cue that sets the parameter ends it.</td></tr>
          </tbody>
        </table>
      </div>
      <p>
        STOP stops the fade where it is and leaves the light on; a Stop cue with a fade-out
        releases it home; a panic does what the show's <strong>On panic</strong> says — hold,
        release or black out. The <strong>Tracking</strong> tab lists every parameter with a
        value at the cue: moved by it, set to what it already was, or tracking from an
        earlier cue. Without a licence the cue stays in the show and is refused when fired.
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
              <td><strong>Port</strong> (or the show's default output) and a list of messages: note on, note off, control change, program change, or raw sysex bytes. <strong>Send now</strong> sends them from the inspector without running the cue.</td>
            </tr>
            <tr>
              <td><strong>OSC</strong></td>
              <td><strong>Host</strong>, <strong>Port</strong>, <strong>Address</strong>, and arguments typed as integer, float, string, true or false. <strong>Send now</strong> sends the message from the inspector without running the cue — the check that the console is listening — and says whether it left.</td>
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
              <td><strong>MIDI File</strong></td>
              <td>Plays a Standard MIDI File (<code>.mid</code>, <code>.midi</code>, <code>.smf</code>, <code>.kar</code>, or an <code>.rmi</code> wrapping one) to one <strong>MIDI Port</strong>, or the show's default output. Formats 0, 1 and 2; the file's tempo map is read whole, so a tempo change anywhere in it moves everything after it, and an SMPTE-timed file plays by its frames. <strong>Rate</strong> 0.25×–4×, <strong>Start time</strong> and <strong>End time</strong> (the region, in the file's own seconds), and <strong>Loop count</strong> (0 plays once, −1 loops until stopped). On the <strong>Channels</strong> tab: each of the file's sixteen channels sent as itself, as another channel, or not at all; and <strong>Transpose</strong> in semitones (±48), which leaves channel 10 — General MIDI's drums — alone unless <strong>Channel 10 too</strong> is ticked. The tab lists the file's tracks by name with their notes, events and channels. The cue completes when its file does, so Auto-follow works; looping until stopped holds the show until a Stop takes it. Started part-way — a timeline seek, a takeover — or at a start time, every channel is first put where the file had it there: program and bank, controllers, RPN and NRPN settings such as the pitch-bend range, pitch bend and pressure; notes already sounding are not struck again. Stopping releases every note the cue started and lifts the sustain pedal on every channel it played on; PANIC also sends All Notes Off on those channels. While it runs, <strong>Pause</strong> holds the file silent and <strong>Resume</strong> plays on from the same place. A file that is not MIDI, or is damaged, says why in the tab and on the cue's Last run; so does a port that is not connected.</td>
            </tr>
            <tr>
              <td><strong>Script</strong></td>
              <td><strong>Script</strong> and <strong>Timeout</strong> (60000 ms; 0 waits for ever). See the <a href="./script-api.html">script API</a>.</td>
            </tr>
            <tr>
              <td><strong>Memo</strong></td>
              <td>A note in the stack — "hold for the bow", "LX 40 is called by the SM". Its words are its <strong>Name</strong> and <strong>Notes</strong> on Basics, and the first line of the note is read on its row. GO completes it at once: an advance passes straight through it, so a memo between two cues never holds the show.</td>
            </tr>
            <tr>
              <td><strong>Mic</strong><span class="pro">Pro</span></td>
              <td><strong>Mic</strong> — the Sennheiser EW-DX channel to act on, chosen from the packs the show knows (named by the plot and who is wearing the pack, or by what the receiver calls it), and <strong>Do</strong>: <strong>Mute</strong> or <strong>Unmute</strong>. There is no toggle, because a toggle run twice leaves the mic as the first run found it, and a cue list that can be jumped around in cannot know which that was. The receiver is asked afterwards: a mute that did not happen is an error on the cue, in the log and on its row, never a mic left open in silence. With no mic chosen the cue does nothing and says so.</td>
            </tr>
            <tr>
              <td><strong>Timecode</strong><span class="pro">Pro</span></td>
              <td>Runs a SMPTE clock. <strong>Rate</strong> — 24, 25, 29.97 drop-frame, 29.97 non-drop or 30 fps (25 for a new cue); <strong>Start from</strong> the <strong>Start</strong> time (01:00:00:00) or the incoming timecode (<strong>jam sync</strong>: the clock starts where the received one is, keeps to it, and carries on alone if it drops out); <strong>End</strong>, or empty to run until stopped — the cue's length is the difference. Outputs, in any mix, all one clock: <strong>MTC</strong> to a MIDI port (the show's output port if none is chosen) — a full-frame message on every start, locate and pause, then quarter frames; <strong>LTC</strong> written by the audio engine to an output channel (3 for a new cue) at a level in dBFS (−12) — give it a channel of its own; <strong>Art-Net</strong> ArtTimeCode once a frame to an address (255.255.255.255), or <code>host:port</code>. While it runs the tab shows where the clock is, with <strong>Pause</strong>/<strong>Resume</strong> and <strong>Locate</strong> to any frame. With no output ticked, or a start or end that is not a frame of the rate, the cue refuses and says why.</td>
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
        The window's own place stays on the machine too: it opens at the size and position
        you left it, maximised if it was, and on the primary display when the monitor it
        was on is no longer connected.
      </p>
    </section>

    <section class="panel reveal delay-1" id="general">
      <h2>General</h2>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Setting</th><th>Default</th><th>What it does</th></tr></thead>
          <tbody>
            <tr><td>Repeat guard</td><td>300 ms</td><td>Ignores a second GO arriving this soon after the first, from the space bar, a trigger or a console. 0 turns it off.</td></tr>
            <tr><td>STOP fade</td><td>0 ms</td><td>How long STOP — <kbd>Esc</kbd>, the button, a remote's <code>/stop</code> — fades everything over. 0 cuts at once. With a fade, the show lets go at once and the sound fades; a second STOP during the fade cuts what is left. Saved with the show.</td></tr>
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
            <tr><td>↳ Remote</td><td>on</td><td>Answers the transport addresses — <code>/go</code>, <code>/stop</code>, <code>/cue/12/start</code> and the rest, in Cuerunner's namespace and QLab's. See <a href="control.html#remote">the remote</a>.</td></tr>
            <tr><td>↳ Allow from</td><td>anyone</td><td>Addresses or IPv4 ranges (<code>10.0.0.5, 192.168.1.0/24</code>). Anyone else's datagrams are dropped before a trigger, the remote or the Monitor sees them, and each refused sender is named once in the log.</td></tr>
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

    <section class="panel reveal delay-3" id="outputs">
      <h2>Outputs</h2>
      <p>
        In the dock's <strong>Outputs</strong> tab. What an output <em>is</em> is kept with
        <strong>this show</strong>; where it goes is kept on <strong>this computer</strong>, by
        output, so a show opened on another machine keeps its outputs and finds them places of
        that machine's own.
      </p>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Setting</th><th>Kept</th><th>Default</th><th>What it does</th></tr></thead>
          <tbody>
            <tr><td>Name</td><td>show</td><td>Output 1, 2…</td><td>What the cues and the card call it, and what Identify draws.</td></tr>
            <tr><td>Display</td><td>computer</td><td>A window</td><td>A window you can move and size, or one of this computer's displays. A display that is not connected opens it as a window with a banner saying which.</td></tr>
            <tr><td>Fullscreen</td><td>computer</td><td>off</td><td>Fills the display chosen. A fullscreen output never takes the keyboard.</td></tr>
            <tr><td>Size</td><td>show</td><td>1920 × 1080</td><td>The size it composes at in a window, or when its display cannot say. Fullscreen, the display's own pixels are used.</td></tr>
            <tr><td>Timer</td><td>show</td><td>No timer</td><td>Time of day, the show clock (from the first GO), or the time left on the cue with an end that started last — and where on the output.</td></tr>
            <tr><td>Test pattern</td><td>—</td><td>off</td><td>Grid, centre, corners and colour bars over the output, at its own resolution.</td></tr>
            <tr><td>Corner pin</td><td>show</td><td>0%</td><td>Moves each corner of the finished frame by a share of the output; the frame is laid on that shape in perspective. Needs the GPU.</td></tr>
            <tr><td>Soft edge</td><td>show</td><td>0%</td><td>Fades each edge to black over a share of the frame, for overlapping projectors. <strong>Edge curve</strong> (1) bends the ramp.</td></tr>
            <tr><td>Identify</td><td>—</td><td>—</td><td>Draws every output's name across it for three seconds.</td></tr>
            <tr><td>Floating timer</td><td>computer</td><td>Off</td><td>A small always-on-top window counting the time of day, the show clock or the cue remaining.</td></tr>
            <tr><td>Shows</td><td>show</td><td>Its own pictures</td><td>Or <strong>the same as</strong> another output: a mirror, showing that output's pictures as it composes them, at its size — a confidence monitor, a stacked projector. It keeps its own display, timer and corner pin; a picture cue cannot name a mirror.</td></tr>
            <tr><td>Mask</td><td>show</td><td>none</td><td>An image laid over the output's pictures, stretched to it: <strong>Mask reads</strong> its brightness (white shows) or its transparency (opaque shows), and <strong>Invert</strong> turns it round. Drawn before the corner pin, under the timer and test pattern. A mirror with no mask of its own shows its source's. Its file is kept by its path, and is not carried into a bundle.</td></tr>
            <tr><td>Next GO</td><td>show</td><td>off</td><td>On, every picture whose cue leaves it to the show is taken down on the next GO.</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="panel reveal delay-3" id="timecode">
      <h2>Timecode</h2>
      <p>Two halves. <strong>Source</strong> and where it arrives — the MIDI input, the audio input and channel, the UDP port — are kept on the computer: which port the clock is on is a fact about this rack. Everything under <strong>This show</strong> — rate, freewheel, chase, what happens when it stops, offset and tolerance — is saved in the show file, so the show follows its clock the same way on any machine that opens it; a show that leaves them all at their defaults carries nothing for them, and an edit to them goes back with undo. The receiver is part of Cuerunner Pro. The <a href="../guides/console.html#timecode">guide</a> shows it in use.</p>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Setting</th><th>Default</th><th>What it does</th></tr></thead>
          <tbody>
            <tr><td>Source</td><td>None</td><td>Where the clock comes from: <strong>MTC</strong> on a MIDI input (the first one there is, if none is chosen; a port MIDI input already has open is shared with it), <strong>LTC</strong> on a channel of an audio input, read by the audio engine, or <strong>Art-Net</strong> ArtTimeCode on a UDP port (6454).</td></tr>
            <tr><td>Rate</td><td>Detect from the stream</td><td>Takes the rate MTC and ArtTimeCode declare, and measures the rest: 29.97 non-drop is told from 30 by timing the stream (a few seconds of it), and LTC's 24, 25 and 30 by its frame numbers. A fixed rate reads every label at that rate instead.</td></tr>
            <tr><td>Freewheel</td><td>1000 ms</td><td>How long a clock that stops arriving is carried on at its own rate before it counts as lost (0–10000). A cue on a frame inside the gap still fires.</td></tr>
            <tr><td>Chase</td><td>off</td><td>The cue list goes where the clock goes: a locate starts each audio or wait cue whose trigger is behind the clock and whose length reaches past it, that far into itself, and stops what the clock started and has left behind. Off, a locate only arms again what the clock is now before.</td></tr>
            <tr><td>When it stops</td><td>Hold</td><td>With chase on, what the cues the clock started do when it stops or is lost: <strong>Hold</strong> stops them and picks them up again where the clock comes back; <strong>Stop</strong> stops them; <strong>Let them run on</strong>.</td></tr>
            <tr><td>Offset</td><td>00:00:00:00</td><td>Added to the incoming clock before any cue reads it, written in 30 fps labels; a leading minus subtracts. How a show written at 10:00:00:00 runs against a clock that starts at 01:00:00:00.</td></tr>
            <tr><td>Tolerance</td><td>10 frames</td><td>How far the clock may skip forward and still fire the triggers it skipped (0–300). A jump further than that is a locate.</td></tr>
          </tbody>
        </table>
      </div>
      <p>The panel under the source reads back the clock as it is heard: position, <strong>Locked</strong>, <strong>Freewheel</strong>, <strong>Stopped</strong>, <strong>Lost</strong> or <strong>Waiting</strong>, the rate and whether it was detected, and what the timecode cues are sending. The same readout is in the transport bar and the show monitor.</p>
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

    <section class="panel reveal delay-3" id="updates">
      <h2>Updates</h2>
      <p>
        Newer versions of Cuerunner, and when this machine may look for them. Kept on the computer,
        not in the show, and free. A check only asks whether there is something newer; nothing is
        downloaded until you press <strong>Download</strong>, nothing is installed until you press
        <strong>Restart now</strong> or quit, and neither happens while anything in the show is
        running. The <a href="../guides/running.html#updates">guide</a> walks it through.
      </p>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Setting</th><th>Default</th><th>What it does</th></tr></thead>
          <tbody>
            <tr><td>This version</td><td>—</td><td>The version running, and how it was installed: Windows installer, macOS app, AppImage, .deb package, or a development build run from source.</td></tr>
            <tr><td>Check now</td><td>—</td><td>Asks the update feed now, and says what it found beside the button: up to date, a newer version with its notes, or that the server could not be reached. Refused, with the reason, during the show hours or in Show Mode with a show open.</td></tr>
            <tr><td>Check automatically</td><td>on</td><td>Checks twenty seconds after launch and then once a day. A check that cannot reach the server says nothing at all — a show machine with no network is an ordinary machine. Off, only <strong>Check now</strong> checks.</td></tr>
            <tr><td>Show hours</td><td>off, 18:00–23:30</td><td>No checks and no downloads between <strong>From</strong> and <strong>To</strong>, by this computer's clock. A window that ends before it starts runs past midnight.</td></tr>
            <tr><td>In Show Mode</td><td>on</td><td>No checks while a show file is open in Show Mode.</td></tr>
          </tbody>
        </table>
      </div>
      <p>What an update offered on this machine can say:</p>
      <div class="table-wrap">
        <table>
          <thead><tr><th>It says</th><th>What it means</th></tr></thead>
          <tbody>
            <tr><td>Cuerunner <em>x.y.z</em> is available.</td><td>A newer release is published. <strong>Release notes</strong> shows every version between this one and it; <strong>Download</strong> fetches it; <strong>Later</strong> puts the bar away until the next launch. The bar is never drawn in Show Mode.</td></tr>
            <tr><td>Held: something in the show is running.</td><td>A download or a restart was asked for while a cue was running, paused or waiting, or while sound or a MIDI file was playing. Nothing was fetched or installed; ask again once the show is idle. A cue started while a download is under way stops the download the same way.</td></tr>
            <tr><td>Refused: the download did not match the checksum its release published…</td><td>The bytes that arrived are not the bytes the release's feed names (SHA-512). They were deleted, and nothing was installed.</td></tr>
            <tr><td>Refused: the update is not signed by the publisher…</td><td>Windows checks that the new installer is signed by the publisher this copy was signed by, and macOS that the new app carries a valid signature. A download that fails either is deleted, and nothing was installed.</td></tr>
            <tr><td>Cuerunner <em>x.y.z</em> is ready.</td><td>Downloaded and checked. It installs when Cuerunner quits — the one thing that happens without a press — or now with <strong>Restart now</strong>, which asks you to save the show first. The installer runs silently and starts the new version.</td></tr>
            <tr><td>…installed from the .deb package, which cannot replace itself</td><td>A <code>.deb</code> belongs to the package manager that installed it: the app says when there is a newer version and <strong>Open the download page</strong> takes you to it. Install the new <code>.deb</code> over the old one; your settings stay.</td></tr>
          </tbody>
        </table>
      </div>
      <p>
        The feed is <code>pub.cuerunner.app/latest/</code> — <code>latest.yml</code> for Windows,
        <code>latest-mac.yml</code> for macOS (a Mac updates from a zip of the app rather than
        the dmg) and <code>latest-linux.yml</code> for the AppImage — and each one names the
        release's own files under <code>versions/</code>. The settings and the version this
        machine last ran are kept in <code>updates.json</code> in the app's data folder.
      </p>
      <p>
        After an update, the first launch shows <strong>What's new</strong>: the notes of every
        version installed since this machine last ran Cuerunner, newest first — skip two releases
        and you read both. It is shown once.
      </p>
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
            <tr><td><kbd>Space</kbd></td><td>GO — fire the selected cue of the list in front and move on to the next cue of that list. With nothing selected, as after the list's last cue, it fires nothing.</td><td>Anywhere except a text field</td></tr>
            <tr><td><kbd>Esc</kbd></td><td>STOP — stop the list in front, at once or over the show's STOP fade; a second press during the fade cuts it. Where no other list is running, that is everything</td><td>Anywhere except a text field. With a menu open, the press closes the menu and stops nothing</td></tr>
            <tr><td><kbd>P</kbd></td><td>PAUSE — hold the whole show where it stands, and let it go on. While it is held GO waits; STOP and PANIC end the hold</td><td>Anywhere except a text field</td></tr>
            <tr><td><kbd>Shift</kbd> + <kbd>Esc</kbd></td><td>PANIC — stop with a short fade</td><td>Anywhere except a text field</td></tr>
            <tr><td><kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>Shift</kbd> + <kbd>P</kbd></td><td>PANIC from the application menu — the same silence, reached without the window</td><td>Anywhere, including while the window is busy</td></tr>
            <tr><td><kbd>F5</kbd></td><td>Show mode — the show in large type, read-only; F5 again to edit</td><td>Anywhere a panel is not open</td></tr>
            <tr><td><kbd>F6</kbd></td><td>Cart — the list as a wall of buttons, each playing its cue; F6 again for the list</td><td>Anywhere a panel is not open</td></tr>
            <tr><td><kbd>1</kbd> … <kbd>9</kbd>, <kbd>0</kbd></td><td>Play the first ten cart tiles</td><td>The cart</td></tr>
            <tr><td>A tile's own key</td><td>Play that tile — set by right-clicking the tile and pressing the key</td><td>Anywhere except a text field, whichever list is in front</td></tr>
            <tr><td><kbd>Ctrl</kbd> + <kbd>Page Down</kbd> / <kbd>Page Up</kbd></td><td>The next or previous cue list tab</td><td>Anywhere a panel is not open</td></tr>
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
            <tr><td><kbd>Delete</kbd></td><td>Delete the selected cue. The selection moves to the cue that took its place, so GO stays where you were working.</td><td>Cue list</td></tr>
            <tr><td><kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>D</kbd></td><td>Duplicate the selected cue</td><td>Cue list</td></tr>
            <tr><td><kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>C</kbd> / <kbd>X</kbd> / <kbd>V</kbd></td><td>Copy, cut or paste the selected cues — a group with everything in it. A paste lands after the cue you stand on, as new cues with the next numbers; a copied fade aimed at a cue copied with it is aimed at that cue's copy. The copy outlives opening another show, so cues move between shows</td><td>Cue list; in a text field the field's own text</td></tr>
            <tr><td><kbd>Enter</kbd> / <kbd>Esc</kbd></td><td>Commit or cancel a rename</td><td>Renaming a cue</td></tr>
            <tr><td><kbd>Esc</kbd></td><td>Close a menu — the row menu, Cuerunner ▾ or More ▾ — or cancel a rename; a bare press is the transport's</td><td>Cue list and toolbar</td></tr>
            <tr><td><kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>Z</kbd></td><td>Undo</td><td>Anywhere except a text field</td></tr>
            <tr><td><kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>Shift</kbd> + <kbd>Z</kbd></td><td>Redo</td><td>Anywhere except a text field</td></tr>
          </tbody>
        </table>
      </div>
      <div class="note">
        Undo is one stack for everything an edit destroys — the cue list, the scenes, the
        desk setup, the cast, the mic plot and how the show follows timecode — so an undo is
        never half a change. It
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
            <tr><td>Timecode</td><td>one source at a time, chosen in Settings → Timecode.</td><td>MTC quarter frames and full-frame locates (<code>F1 0n</code>, <code>F0 7F dd 01 01 hh mm ss ff F7</code>) on a MIDI input; LTC on an audio input channel; ArtTimeCode (OpCode 0x9700) on UDP 6454. Lock and loss are alarms in the Monitor and the run log.</td></tr>
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
        whether or not the interface is answering. The lights follow the show's own
        <strong>On panic</strong> rule (Lighting → Network): they hold where they are unless
        the show says release or black out. A window that stops answering is not a panic for
        the lights — they run beside the engine, not in the window. The run log records the sender:
        <code>[main] panic (osc): /cuerunner/panic from 192.168.1.24:8000</code>.
      </p>
    </section>

    <section class="panel reveal delay-1" id="remote">
      <h2>The remote</h2>
      <p>
        The OSC port also answers the transport, so a tablet or a console can run the show
        without a cue written for each press. Two namespaces are answered: Cuerunner's own,
        under <code>/cuerunner</code>, and QLab's bare one — with or without the
        <code>/workspace/{id}</code> prefix QLab's remotes send — so a remote set up for QLab
        on port 53000 runs a Cuerunner show unchanged. Verbs are read without regard to case
        or underscores: <code>hardStop</code>, <code>hardstop</code> and <code>hard_stop</code>
        are one address.
      </p>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Address</th><th>Effect</th></tr></thead>
          <tbody>
            <tr><td><code>/go</code></td><td>GO, exactly as <kbd>Space</kbd>: the selected cue of the list in front fires and the selection moves on.</td></tr>
            <tr><td><code>/stop</code>, <code>/hardStop</code></td><td>STOP, as <kbd>Esc</kbd>: the list in front is cut where it stands — everything, where no other list is running.</td></tr>
            <tr><td><code>/panic</code></td><td>Panic, answered where the engine is, as <code>/cuerunner/panic</code> is.</td></tr>
            <tr><td><code>/pause</code>, <code>/resume</code>, <code>/togglePause</code> (also <code>/pause_toggle</code>)</td><td>Hold the whole show, let it go on, or whichever it is not — as <kbd>P</kbd> does.</td></tr>
            <tr><td><code>/cue/{number}/pause</code>, <code>/resume</code>, <code>/togglePause</code></td><td>Hold one playing audio cue while the rest of the show goes on, and let it go.</td></tr>
            <tr><td><code>/select/next</code>, <code>/select/previous</code> (also <code>/playhead/…</code>)</td><td>Move the selection one row, over the rows the list shows. Nothing fires.</td></tr>
            <tr><td><code>/select/{number}</code>, <code>/cue/{number}/select</code></td><td>Stand on that cue. Nothing fires.</td></tr>
            <tr><td><code>/cue/{number}/go</code></td><td>Stand on that cue and press GO.</td></tr>
            <tr><td><code>/cue/{number}/start</code></td><td>Fire that cue where it is; the selection stays where the operator left it. A disarmed cue is not fired, and the log says so.</td></tr>
            <tr><td><code>/cue/{number}/stop</code></td><td>Stop that cue (and a group's children with it).</td></tr>
            <tr><td><code>/cue/{number}/seek</code> <em>seconds</em></td><td>Move a running audio cue to that many seconds into its region.</td></tr>
            <tr><td><code>/cue_id/{id}/…</code></td><td>The same verbs, for the cue with that id. QLab counts a cue list as a cue, and so does this: <code>/cue_id/{list id}/go</code> is GO on that list, <code>/stop</code> stops it and <code>/select</code> brings it to the front. A list imported from QLab keeps QLab's id.</td></tr>
            <tr><td><code>/list/{list}/go</code> (also <code>/cueList/…</code>, <code>/cueLists/…</code>; <code>/start</code>)</td><td>GO on that list's own place, without bringing it to the front. The list is named by its id, its name (any case) or its place among the tabs counting from 1.</td></tr>
            <tr><td><code>/list/{list}/stop</code></td><td>Stop what is running in that list, and nothing else.</td></tr>
            <tr><td><code>/list/{list}/select</code></td><td>Bring that list to the front.</td></tr>
            <tr><td><code>/list/{list}/next</code>, <code>/previous</code></td><td>Move that list's place one cue, without bringing it to the front. Nothing fires.</td></tr>
            <tr><td><code>/list/{list}/arm</code>, <code>/disarm</code></td><td>Put the list back in the show, or take it out: a disarmed list fires nothing, by GO, trigger or clock.</td></tr>
          </tbody>
        </table>
      </div>
      <p>
        <code>{number}</code> is the cue's number as the list shows it, or
        <code>selected</code> / <code>playhead</code> for the cue the selection stands on.
        Every press is written to the run log with its sender — <code>GO from OSC /go from
        10.0.0.5:53001</code> — and a number the show does not have is an error line rather
        than a silence. The repeat guard (Settings → General) stands in front of the remote
        as it does in front of a trigger, so a desk that sends twice steps once. An address
        a cue's own trigger answers is left to that cue: a show that wired <code>/go</code>
        to one cue keeps it.
      </p>
      <p>
        Turn the remote off with the Remote box under Settings → Network; triggers and
        <code>/cuerunner/panic</code> still answer. <strong>Allow from</strong> closes the port
        to everyone not on its list — triggers, remote and Monitor alike.
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
            <tr><td>Timecode<span class="pro">Pro</span></td><td>The frame of the incoming clock, at the rate it is read at — typed as a label, as seconds from midnight (<code>3610s</code>), or taken from the running clock with <strong>Take</strong>: the cue fires as the clock runs through it, once per pass, and again after the clock goes back before it. A skip of up to the tolerance still fires; a locate past it does not, unless chase is on.</td><td>Which wire the clock came in on.</td></tr>
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
            <tr><td>MIDI File cue</td><td>The file's own messages — notes, controllers, programs, bends, pressure and SysEx; never its meta events — at the file's times, through the cue's channel map and transposition, on the cue's port or the show's default output. On a stop: a Note Off for every note it started and Sustain (CC 64) 0 on each channel it used; on PANIC, All Notes Off (CC 123) on those channels too.</td></tr>
            <tr><td>Show Control cue</td><td>An MSC message: command, equipment format, device ID (127 reaches everything), and cue and list where the command carries them.</td></tr>
            <tr><td>Light cue<span class="pro">Pro</span></td><td>Nothing of its own: it hands the lighting engine its look, and the engine sends every universe that has an output — on a change, and again every 800 ms unchanged, at up to 44 frames a second. sACN (E1.31) data packets carry the machine's source name and component identifier, the output's priority and, when the show synchronises, the sync universe, followed by a universe synchronisation packet; Art-Net 4 sends ArtDmx, then ArtSync when synchronised. Stopping the output sends sACN's stream-terminated packets three times, so a receiver lets go at once.</td></tr>
            <tr><td>Timecode cue<span class="pro">Pro</span></td><td>MTC: a full-frame message (device 7F) where the clock starts, pauses or is located, then four quarter frames a frame, each set of eight starting on an even frame. LTC: the 80-bit SMPTE word, biphase-mark, at the cue's level on its output channel, with the drop-frame flag set at 29.97 drop-frame. ArtTimeCode: one 19-byte datagram a frame. 29.97 non-drop has no code of its own in MTC or Art-Net and is sent as 30.</td></tr>
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
        setup — the desk, the cast, the scenes, the mic plot, the triggers, the lighting rig —
        and the window's own state such as which cue was selected. The rig is a
        <code>lighting</code> section — fixtures, the types they are, groups, each universe's
        outputs and the consoles heard — written only once a show has one, so a show with no
        lights saves the bytes it always did. Which network interface the lights leave by,
        and the sACN identity this machine sends as, are the machine's, in
        <code>dmx.json</code> beside the licence.
      </p>
      <p id="gdtf">
        <strong>A fixture type read from a GDTF file</strong> (DIN SPEC 15800; Lighting →
        Patch → Import GDTF file…, part of Cuerunner Pro) is copied into the show like any
        other type, so the show does not need the file again. Only the archive's
        <code>description.xml</code> is read — the models and wheel images beside it are
        not — up to 16 MB of XML, and a description that declares a document type is
        refused. Each <code>DMXMode</code> becomes a mode, as wide as its highest offset. Each
        <code>DMXChannel</code> with an offset becomes a parameter: its kind from the
        attribute of the function it starts on (<code>Dimmer</code>, <code>Pan</code>,
        <code>Tilt</code>, <code>ColorAdd_R</code> and the other emitters, colour wheels and
        macros as colour, everything else as other), its label from the attribute's pretty
        name — with the geometry after it where cells share an attribute — its coarse and
        fine slots from <code>Offset</code>, and where it rests from the default of its
        initial function (or, in a GDTF 1.0 file, the channel's own <code>Default</code>).
        A channel with more than one <code>ChannelFunction</code> keeps each one's name and
        the share of travel it starts at (<code>DMXFrom</code>), up to 64, and the faders name
        the one a value is in. A 24- or 32-bit channel is driven on its two most significant
        bytes and the bytes below are held at zero. A virtual channel (no offset) is left out.
        Refused, with a sentence: a mode spread over more than one <code>DMXBreak</code>, a
        channel that overwrites another break, an offset past 512, two channels on one slot,
        a mode with no DMX channels, more than 32 modes or 128 parameters to a mode.
      </p>
      <p>
        A show with more than one cue list carries a <code>cueLists</code> section: each list's
        id, name, colour, whether it is a cart, whether it is disarmed, how it follows the
        clock and its tiles' own keys, in tab order. A cue at the top level of a list other than
        the main one names it with <code>listId</code>; a cue inside a group never does — it runs
        in its group's list. A show with only its main list under its own name writes no
        section and no <code>listId</code>, so a show saved before lists existed opens as one
        list and saves the bytes it always did. A cue naming a list the file does not have runs
        in the main list, and the bar across the top says so, the way a grouping repair does.
      </p>
      <p>
        <strong>It does not hold the audio.</strong> Each audio cue stores the path to its
        file. Moving a show to another machine means taking the sound with it and keeping
        the paths valid: the simplest arrangement is a folder with the <code>.cuerunner</code>
        file and the audio beside it, copied whole.
      </p>
      <p>
        Video and image cues store their files the same way, and move with the show the
        same way. The show's outputs are a <code>videoOutputs</code> list — name, size, timer,
        corner pin and soft edges, a mirror and a mask — written only when the show has one;
        where each output goes on a computer is kept on that computer, in
        <code>video-outputs.json</code> beside the licence. A show whose pictures go on the next
        GO carries a <code>pictures</code> section; a camera cue carries its camera's name, and
        each computer keeps the device it picked for that cue in <code>camera-devices.json</code>.
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

    <section class="panel reveal delay-1" id="qlab">
      <h2>QLab workspaces</h2>
      <p>
        <strong>Import QLab Workspace&hellip;</strong> reads a <code>.qlab5</code> or
        <code>.qlab4</code> workspace, a QLab 5 workspace saved as a folder (the property list
        inside it), and a <code>.cues</code> file of cues with no list around them. A workspace
        is an NSKeyedArchiver archive in a binary property list, with its cue lists stored as a
        second archive inside the first; both are Apple's container formats, read by
        Cuerunner's own reader. A workspace past <strong>64 MB</strong> is refused before it is
        read, and so is one holding more than <strong>10,000</strong> cues.
      </p>
      <p>
        From a running QLab, the import connects over TCP to the address and port given
        (<code>53000</code> by default), SLIP-framed as QLab's OSC over TCP is, and sends
        <code>/workspaces</code>, <code>/workspace/{id}/connect</code> with the passcode,
        <code>/workspace/{id}/cueLists</code>, and <code>/workspace/{id}/cue_id/{id}/valuesForKeys</code>
        once for each cue. One message is in flight at a time. The connection has 3 seconds
        to open and every reply 5 seconds to arrive; a reply larger than 16 MB, or a
        conversation past 64 MB, ends the import.
      </p>
      <p>
        The result is a new show with no file, checked by the same reading every
        <code>.cuerunner</code> file goes through. Audio paths are absolute: the QLab
        workspace's folder joined to the path QLab recorded relative to it, or QLab's last
        known absolute path where there is none. The mapping is in
        <a href="../guides/qlab.html#mapping">Coming from QLab</a>.
      </p>
      <div class="table-wrap">
        <table>
          <thead><tr><th>The import says</th><th>Because</th></tr></thead>
          <tbody>
            <tr><td>… is not a QLab workspace</td><td>The file is not a binary property list, which every QLab workspace is.</td></tr>
            <tr><td>… looks like a QLab workspace but cannot be read</td><td>It is a property list whose bytes contradict themselves, or not an archive; the rest of the sentence says which.</td></tr>
            <tr><td>… holds no QLab cue lists</td><td>An archive, but not of a QLab show.</td></tr>
            <tr><td>… is N MB, and a QLab workspace this import reads is at most 64 MB</td><td>The size limit, checked before the file is read.</td></tr>
            <tr><td>no QLab answered at …</td><td>Nothing is listening at that address and port, or QLab's OSC access does not let this computer in.</td></tr>
            <tr><td>… did not accept that passcode</td><td>The workspace's passcode is not the one typed.</td></tr>
            <tr><td>… stopped answering</td><td>A reply did not arrive within 5 seconds.</td></tr>
          </tbody>
        </table>
      </div>
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
              <td>An audio cue fires and nothing plays</td>
              <td>Its row says why. <em>no file</em>: the cue has not been given one — pick it with Browse on the Audio tab. <em>missing</em>: the file could not be read, and the Audio tab says whether it was not found or is not a format Cuerunner plays. After a GO the row is marked <em>failed</em> and the log carries the same reason.</td>
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
              <td>The show plays out of the wrong outputs after it is opened on another machine</td>
              <td>The show names an output device this machine does not have. The engine refuses it and stays on the device it already had open, and the transport bar says <em>Output device refused</em>. Press it, or open Settings → Audio, and choose this machine's device.</td>
            </tr>
            <tr>
              <td>No audio cue plays, and the transport bar says <em>Audio engine not answering</em></td>
              <td>The engine process did not start, or has stopped. Waits and the cues that do not make sound still run. Settings → Audio → Reconnect device starts it again, and the Log has the engine's own reason.</td>
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
              <td>A video, image or text cue fails with <em>the show has no video output</em></td>
              <td>The show has no output, or the cue names one that was removed. Add one in the dock's Outputs tab, or choose another on the cue's Picture tab.</td>
            </tr>
            <tr>
              <td>An output has a red banner across it</td>
              <td>The display it was placed on is not connected, so it opened as a window. Plug the display in and it moves back; or choose another on its card. A banner naming a camera means that camera is not connected (or another program has it); a banner naming a mask means its file could not be read.</td>
            </tr>
            <tr>
              <td>The camera list says to open an output</td>
              <td>Only an output window may open a camera, so the list comes from one. Add or open an output. On a Mac, allow Cuerunner under Camera in the Mac's Privacy &amp; Security settings.</td>
            </tr>
            <tr>
              <td>A camera cue fails with <em>RTSP streams are not supported</em></td>
              <td>Cuerunner reads HTTP video, HLS and MJPEG. Most IP cameras serve one of them too: use that address.</td>
            </tr>
            <tr>
              <td>A video plays with no sound</td>
              <td>The file has no sound track (its Sound tab says so), or — a WebM or MKV on Windows — the computer has no decoder for its sound. The picture still plays; convert the file to MP4 for sound everywhere.</td>
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
        <li>Video plays what Chromium decodes (H.264, VP8, VP9, AV1 and the rest); ProRes and other professional codecs need converting first. On Windows a WebM's or MKV's sound needs the system's own decoder for it, and plays silent where there is none.</li>
        <li>One crossfade at a time per output: a second that starts while one is running lands the first at once. Blend modes other than normal are not offered.</li>
        <li>No cue-level audio effects beyond level, pan, rate and fades.</li>
        <li>ASIO runs a single driver at a time and at most 32 channels: a rig that needs two interfaces on two ASIO drivers at once is not covered.</li>
        <li>OSC input is UDP only.</li>
        <li>The channel ceiling a desk model states is the number the console publishes rather than a measurement: a show with more channels than the selected model takes is named under the desk connection, with the number, and every channel is sent as it always was. Only the count control stops at it, and a show already larger than the ceiling keeps its own whole range on the dial rather than being trimmed back to it.</li>
        <li>An SQ's membership is written over the desk's own control service — TCP 51326 outbound, with a keepalive datagram to the desk's UDP 51324 — a protocol Allen &amp; Heath publish nothing about, spoken here from frames measured off an SQ-6 on firmware 1.6.1. The desk's own answer to a membership has never been read, so nothing here says a desk has accepted one: what a recall leaves out is worked out against what Cuerunner last sent, not against the desk. The channel mutes ride the MIDI service beside it, on 51325. The session leaves by the desk's own door when the show stops, and one the desk loses without that goodbye leaves it mute until it is reset — said in the log, on the device row and in an alarm, which is why a lost session is not dialled again in a loop.</li>
        <li>The lighting is DMX over the network, not a console: a patch, faders, groups and Light cues with tracking — no palettes, no command line, no pixel-matrix fixtures, and no fixture library beyond an Open Fixture Library file or a GDTF file read in — a GDTF fixture split over several DMX breaks is refused rather than patched as one. 64 universes and 2048 fixtures to a show. The packets are held byte for byte to the sACN and Art-Net documents and to a listener on this machine; no hardware node has been part of a run. The tracking sheet reads the Light cues in list order and does not account for what a Stop or Fade cue does at show time.</li>
        <li>A redundant pair both send their lights when both are licensed and both have outputs: the standby's levels are not the live machine's, and receivers merging two sources at one priority take the higher of each slot. Give the standby no outputs, or a lower sACN priority.</li>
        <li>The tablet view is read-only by design.</li>
        <li>Cuerunner is distributed outside the app stores, and the release notes say whether a build is signed: Windows warns when an unsigned installer is run, and macOS warns about an unidentified developer at first launch — Gatekeeper refuses such an app on a machine that has not seen it. Each release publishes its digests twice: a <code>SHA256SUMS</code> beside the assets on its release page, naming the files that page carries, and <code>latest/SHA256SUMS</code> on the download host, naming the files the cards link.</li>
        <li>The Linux AppImage is experimental: MIDI needs ALSA development headers present when dependencies are installed.</li>
      </ul>
    </section>
`
  }
]
