// The support page: where to write, and what to read first.
//
// A support page owes a reader two facts: the address, and where to look before writing to it.
// The address is declared in `website/docs/contact.mjs`; scripts/support-page.test.ts holds the
// page to it and to the app's labels.
import { attr } from './attr.mjs'
import { ORDER_EMAIL } from './contact.mjs'

/**
 * The app's own words for the report: the menu item that opens it and the three buttons under
 * it. The guard reads each back out of `src/shared/fileMenu.ts` and `ReportDialog.tsx`, so the
 * page cannot send anyone looking for a control that has moved.
 */
export const REPORT_ITEM = 'Report a Problem…'
export const REPORT_BUTTONS = ['Copy', 'Save…', 'Email…']

export const SUPPORT = [
  {
    path: 'support.html',
    title: 'Support',
    blurb: `One address, the guides and the reference to look at first, and how to report a problem.`,
    body: `
    <section class="panel reveal">
      <h1>Support</h1>
      <p class="doc-lede">
        File bugs and feature requests on <a href="https://github.com/Huckcity/cuerunner/issues">GitHub Issues</a>,
        or write to <a href="mailto:${attr(ORDER_EMAIL)}">${attr(ORDER_EMAIL)}</a>. Support is best-effort:
        Cuerunner is free and open source, and comes with no warranty.
      </p>
    </section>

    <section class="panel reveal delay-1">
      <h2>Look here first</h2>
      <ul class="tight-list">
        <li>The <a href="reference/troubleshooting.html">troubleshooting reference</a>: a cue
          that will not fire, a file that has moved, a device that dropped out mid-show, a
          trigger that is not being heard.</li>
        <li>The <a href="guide.html">guides</a> build a show from nothing, and the
          <a href="reference/index.html">reference</a> has every cue type, field and setting.</li>
      </ul>
      <p class="note">
        A message that says what you did and what happened is answered in one pass rather than
        three, and a line from the log is worth more than a description of the sound it made.
      </p>
    </section>

    <section class="panel reveal delay-1">
      <h2>Report a problem</h2>
      <p>
        <strong>Cuerunner ▾ → ${REPORT_ITEM}</strong> builds the report for you and shows it
        in full before anything leaves: the version, the machine, what the audio engine says
        about itself, the crash dumps Windows or macOS left, and the
        end of the session log. Say what happened in the box above it.
      </p>
      <p>
        <strong>${REPORT_BUTTONS[0]}</strong> and <strong>${REPORT_BUTTONS[1]}</strong> keep it
        on your machine. <strong>${REPORT_BUTTONS[2]}</strong> puts it on the clipboard and opens
        a message to <a href="mailto:${attr(ORDER_EMAIL)}">${attr(ORDER_EMAIL)}</a> for you to
        paste it into and send.
      </p>
      <p class="note">
        Cuerunner sends nothing itself, ever: no crash uploads, no usage counts. Your home
        folder is replaced by <code>~</code>; the report holds no cue names, and no show
        contents. Crash dumps are listed by name and are not included — attach one if asked.
      </p>
    </section>

`
  }
]
