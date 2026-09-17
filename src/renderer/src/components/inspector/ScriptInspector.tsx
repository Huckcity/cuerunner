import { useStore } from '../../store'
import type { ScriptCue } from '../../../../shared/cue'
import { LastRun } from './LastRun'
import { ResetButton } from './ResetButton'
import { NumberField } from '../common/Field'
import { SCRIPT_DEFAULTS } from '../../utils/cueDefaults'

const LANGUAGES: ScriptCue['language'][] = ['javascript']

interface Props { cue: ScriptCue }

export function ScriptInspector({ cue }: Props) {
  const update = useStore(s => s.updateCue)
  const set = (patch: Partial<ScriptCue>) => update(cue.id, patch)

  return (
    <div>
      <div className="field-row">
        <label>Language</label>
        <select value={cue.language} onChange={e => set({ language: e.target.value as ScriptCue['language'] })}>
          {LANGUAGES.map(l => <option key={l} value={l}>JavaScript</option>)}
        </select>
      </div>

      <div className="field-section-title">Script</div>
      <textarea
        className="inspector-code"
        value={cue.script}
        rows={12}
        spellCheck={false}
        placeholder={"await shell('echo hello')"}
        onChange={e => set({ script: e.target.value })}
      />

      <div className="field-row">
        <label>Timeout (ms)</label>
        <NumberField when="typed" min={0} value={cue.timeout}
          onValue={timeout => { if (timeout !== null) set({ timeout }) }} />
        <ResetButton label="Timeout" value={cue.timeout} defaultValue={SCRIPT_DEFAULTS.timeout}
          onReset={() => set({ timeout: SCRIPT_DEFAULTS.timeout })} />
      </div>

      <p className="inspector-hint">
        Runs when the cue fires and holds the show until it finishes. Anything it prints
        goes to the log panel.
      </p>

      {/* The panel used to carry four paragraphs of this, which is a reference page
          standing where a hint goes. It stays in the app — a show machine has no network
          to look it up on — but behind a press. */}
      <details className="disclosure">
        <summary>What a script can call</summary>
        <div className="disclosure-body script-help">
          <p>
            <code>await</code> works. A script that outlasts its timeout is stopped and
            reported as a failure; 0 waits for ever. STOP, panic and a stop cue aimed at
            this one all end it.
          </p>
          <p>
            <code>console.log()</code> and <code>console.error()</code> write to the log
            panel. A script cannot reach the interface.
          </p>
          <p>
            <code>shell(command, options?)</code> runs a system command and resolves{' '}
            <code>{'{ stdout, stderr, code, signal }'}</code>. Options:{' '}
            <code>timeout</code> (ms, default 10000), <code>cwd</code>, <code>env</code>.
            Commands start in the workspace folder.
          </p>
          <p>
            <code>include('path/to/file.js')</code> runs another JavaScript file and
            resolves what it returned. Each file runs once per cue however many times it
            is included, and an include inside a file is relative to that file.
          </p>
        </div>
      </details>

      <LastRun cueId={cue.id} />
    </div>
  )
}
