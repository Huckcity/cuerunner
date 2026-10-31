// Where Cuerunner stops and the rest of the rig starts. A reader asks the video question
// before they ask anything else, and the answer is a page rather than a reply.
//
// Two claims here stand on lanes with nothing to point at yet — A&H desk acceptance and the
// end-to-end MSC case — so they carry the phrase `pro.mjs` exports, immediately behind their
// words: one string, never a second copy of it. `website/docs/lane-claims.mjs` declares both
// claims, and `scripts/lane-claims.test.ts` holds this page and the record together.
import { NOT_YET_PROVED } from './lane-claims.mjs'

export const INTEROP = [
  {
    path: 'interop.html',
    title: 'Working with other programs',
    blurb: 'Cuerunner owns the cue list, the sound and the clock. Video, lighting and the buttons are better at what they do — here is how the pieces talk.',
    body: `
    <section class="panel reveal">
      <h1>Working with other programs</h1>
      <p class="doc-lede">
        Cuerunner owns the cue list, the sound and the clock. Everything else in the room is
        already good at its own job, and a cue is how you ask it to do that job now.
      </p>
    </section>

    <section class="panel reveal delay-1">
      <h2>Video</h2>
      <p>
        Cuerunner plays video, images and text on outputs of its own — see the
        <a href="guides/video.html">video guide</a> — with the sound through the same engine
        as every other cue. A rig whose pictures belong to another program —
        Resolume, Mitti, vMix, a media server — is driven the other way: the ones that listen
        for OSC take the roll from an <a href="reference/cue-types.html">OSC cue</a>: the cue names the host,
        the port and the address, so the video roll sits in the same list as the sound, in
        the same order, fired by the same GO. A program that takes MIDI instead is a
        <a href="reference/cue-types.html">MIDI cue</a>, and one that speaks show control
        takes the go, stop, load or reset of a
        <a href="reference/cue-types.html">show-control cue</a> — the same message a
        lighting console would take.
      </p>
      <p class="note">
        One program keeps the clock; two programs keeping the clock is how a show drifts —
        which is why Cuerunner's own outputs follow the engine's clock frame by frame.
      </p>
    </section>

    <section class="panel reveal delay-2">
      <h2>Lighting</h2>
      <ul>
        <li>An ETC Eos desk, or an Allen &amp; Heath SQ or Avantis
          ${NOT_YET_PROVED}, is driven directly: the
          <a href="guides/desk.html">desk guide</a> covers the scenes and the cues that move
          it, and the show's GO is what moves it.</li>
        <li>Any console that speaks MSC takes <a href="reference/cue-types.html">show-control
          cues</a> ${NOT_YET_PROVED} — go, stop, resume, load, reset, to the
          format and the device id the console expects.</li>
        <li>Cuerunner can run the rig itself: a fixture patch, faders to build a
          look, and <a href="guides/lighting.html">Light cues</a> that fade it out of this
          machine as sACN or Art-Net, with tracking. A console on the same network can be
          watched, or merged in.</li>
        <li>The traffic runs both ways. A desk's keys can fire Cuerunner cues through the
          <a href="reference/control.html">messages a cue answers to</a>, so the desk can
          walk the show instead of Cuerunner walking the desk.</li>
      </ul>
    </section>

    <section class="panel reveal delay-3">
      <h2>Buttons, phones and tablets</h2>
      <ul>
        <li>A Stream Deck, a Companion button, a TouchOSC page or anything else that can
          send OSC is pointed at the address a cue answers to — that is the whole wiring,
          and it works on a machine with no key.</li>
        <li>The tablet view is the other direction: a read-only page served on the local
          network, for the person calling the show.</li>
        <li>Panic has an address of its own — <code>/cuerunner/panic</code> — so the button
          that stops everything does not have to be a cue.</li>
      </ul>
    </section>

    <section class="panel reveal delay-4">
      <h2>The showfile</h2>
      <p>
        <code>.cuerunner</code> is JSON with a stable byte order: the same show saves the
        same bytes, so it lives in version control beside the show's notes and its plots,
        and a diff between two saves says which cues moved. What it does not do yet is read
        another program's session file — an import from QLab or SCS is a wish, not a
        feature, and this page will say so until it is not.
      </p>
    </section>
`
  }
]
